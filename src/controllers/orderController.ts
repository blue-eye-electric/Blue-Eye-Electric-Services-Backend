import crypto from 'crypto';
import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { AuthRequest } from '../middleware/authMiddleware';
import { sendJobAssignedNotification } from '../services/sendJobAssignedNotification';
import { sendNewOrderNotificationToAdmins } from '../services/sendNewOrderNotificationToAdmins';
import { isUserAdmin } from '../helpers/isUserAdmin';

export const createOrder = async (
  req: Request,
  res: Response,
) => {
  try {
    const {
      customerName,
      customerPhone,
      customerAddress,
      latitude,
      longitude,
      inspection,
      service,
      serviceDate,
      serviceTime,
      serviceArea,
      description,
      isProjectDiscussion,
      referralCode,
    } = req.body;

    const normalizedServiceArea = String(serviceArea ?? '').trim();
    const normalizedReferralCode = String(referralCode ?? '')
      .trim()
      .toUpperCase();

    // Validate required fields
    if (
      !customerName ||
      !customerPhone ||
      !customerAddress ||
      !normalizedServiceArea
    ) {
      return res.status(400).json({
        success: false,
        message: 'Required fields are missing',
      });
    }

    let referralCommission: number | null = null;

    if (normalizedReferralCode) {
      const { data: referral, error: referralError } = await supabase
        .from('referrals')
        .select('referral_code, commission')
        .eq('referral_code', normalizedReferralCode)
        .maybeSingle();

      if (referralError) {
        console.error('Supabase referral lookup error:', referralError);

        return res.status(500).json({
          success: false,
          message: 'Failed to validate referral code',
        });
      }

      if (!referral) {
        return res.status(400).json({
          success: false,
          message: 'Wrong referral code, check the referral code and try again',
        });
      }

      referralCommission = referral.commission;
    }

    /*
     * Get uploaded photos
     */
    const uploadedFiles = req.files as
      | Express.Multer.File[]
      | { [fieldname: string]: Express.Multer.File[] }
      | undefined;

    const photos = Array.isArray(uploadedFiles)
      ? uploadedFiles
      : [
          ...(uploadedFiles?.photos ?? []),
          ...(uploadedFiles?.orderPhotos ?? []),
        ];

    /*
     * 1. Create order first
     * This gives us the order ID.
     */
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_address: customerAddress,
        latitude,
        longitude,
        service_date: serviceDate,
        service_time: serviceTime,
        service_area: normalizedServiceArea,
        description,
        status: 'pending',
        electrician_id: null,
        inspection,
        service_type: service,
        is_project_discussion: isProjectDiscussion,
        referral_code: normalizedReferralCode || null,
        referral_commission: referralCommission,
        photo_urls: [],
      })
      .select('id')
      .single();

    if (orderError || !order) {
      console.error('Supabase order error:', orderError);

      return res.status(500).json({
        success: false,
        message: 'Failed to create order',
      });
    }

    const orderId = order.id;

    /*
     * 2. Upload photos using orderId in the path
     *
    * {orderId}/
    *   photo-uuid.jpg
    *   photo-uuid.png
     */
    const photoPaths: string[] = [];
    const photoUrls: string[] = [];

    for (const photo of photos) {
      const extension =
        photo.originalname
          .split('.')
          .pop()
          ?.toLowerCase() || 'jpg';

      const photoPath = `${orderId}/${crypto.randomUUID()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from('orderPhotos')
        .upload(photoPath, photo.buffer, {
          contentType: photo.mimetype,
          upsert: false,
        });


      if (uploadError) {
        console.error(
          'Order photo upload error:',
          uploadError,
        );

        /*
         * Delete already uploaded photos
         */
        if (photoPaths.length > 0) {
          await supabase.storage
            .from('orderPhotos')
            .remove(photoPaths);
        }

        /*
         * Delete order because photo upload failed
         */
        await supabase
          .from('orders')
          .delete()
          .eq('id', orderId);

        return res.status(500).json({
          success: false,
          message: 'Failed to upload order photos',
        });
      }

      photoPaths.push(photoPath);

      const { data: publicUrlData } =
        supabase.storage
          .from('orderPhotos')
          .getPublicUrl(photoPath);

      photoUrls.push(publicUrlData.publicUrl);
    }

    /*
     * 3. Update order with photo URLs
     */
    if (photoUrls.length > 0) {
      const { error: updateError } = await supabase
        .from('orders')
        .update({
          photo_urls: photoUrls,
        })
        .eq('id', orderId);

      if (updateError) {
        console.error(
          'Order photo URL update error:',
          updateError,
        );

        /*
         * Remove uploaded photos
         */
        if (photoPaths.length > 0) {
          await supabase.storage
            .from('orderPhotos')
            .remove(photoPaths);
        }

        /*
         * Remove order
         */
        await supabase
          .from('orders')
          .delete()
          .eq('id', orderId);

        return res.status(500).json({
          success: false,
          message: 'Failed to save order photos',
        });
      }
    }

    /*
     * 4. Notify admins
     */
    sendNewOrderNotificationToAdmins({
      title: 'New Order Received',
      message: `New order received from ${customerName}`,
      type: 'NEW_ORDER',
      orderId,
    }).catch((error) => {
      console.error(
        'Background admin notification error:',
        error,
      );
    });

    return res.status(201).json({
      success: true,
      orderId,
    });
  } catch (error) {
    console.error('Create order error:', error);

    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getOrders = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const {
      electricianId,
      status,
      page,
      limit,
      isProjectDiscussion,
    } = req.query;

    const parsedPage = Number(
      Array.isArray(page) ? page[0] : page ?? 1,
    );

    const parsedLimit = Number(
      Array.isArray(limit) ? limit[0] : limit ?? 10,
    );

    if (!Number.isInteger(parsedPage) || parsedPage < 1) {
      return res.status(400).json({
        success: false,
        message: 'Page must be a positive integer',
      });
    }

    if (
      !Number.isInteger(parsedLimit) ||
      parsedLimit < 1 ||
      parsedLimit > 100
    ) {
      return res.status(400).json({
        success: false,
        message: 'Limit must be between 1 and 100',
      });
    }

    const offset = (parsedPage - 1) * parsedLimit;

    const userId = req.user?.id;
    

    // Determine admin status using database check

    const isAdmin = await isUserAdmin(userId|| '');

    let query = supabase
      .from('orders')
      .select(
        `
          id,
          electrician_id,
          customer_name,
          customer_phone,
          customer_address,
          latitude,
          longitude,
          service_date,
          service_time,
          service_area,
          service_type,
          description,
          photo_urls,
          status,
          mode_of_payment,
          payment_details,
          total_amount,
          is_project_discussion,
          created_at,
          referral_code,
          referral_commission
        `,
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + parsedLimit - 1);

    /*
     * Electrician can only see their own orders
     */
    if (req.user?.role === 'electrician') {
      query = query.eq('electrician_id', req.user.id);
    } else if (
      typeof electricianId === 'string' &&
      electricianId
    ) {
      query = query.eq('electrician_id', electricianId);
    }

    /*
     * Filter by status only when provided
     */
    if (typeof status === 'string' && status) {
      query = query.eq('status', status);
    }

    /*
     * Filter by project discussion only when provided
     *
     * ?isProjectDiscussion=true
     *    -> is_project_discussion = true
     *
     * ?isProjectDiscussion=false
     *    -> is_project_discussion = false
     *
     * No parameter
     *    -> don't filter, return all orders
     */
    if (
      typeof isProjectDiscussion === 'string' &&
      isProjectDiscussion !== ''
    ) {
      if (
        isProjectDiscussion !== 'true' &&
        isProjectDiscussion !== 'false'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'isProjectDiscussion must be true or false',
        });
      }

      query = query.eq(
        'is_project_discussion',
        isProjectDiscussion === 'true',
      );
    }

    const { data, error, count } = await query;

    if (error) {
      console.error('Supabase get orders error:', error);

      return res.status(500).json({
        success: false,
        message: 'Failed to fetch orders',
      });
    }

    let orders = data ?? [];

    if (isAdmin && orders.length > 0) {
      const referralCodes = [
        ...new Set(
          orders
            .map((order) => order.referral_code)
            .filter(
              (code): code is string =>
                typeof code === 'string' && code.trim() !== '',
            ),
        ),
      ];

      if (referralCodes.length > 0) {
        const {
          data: referrals,
          error: referralError,
        } = await supabase
          .from('referrals')
          .select('referral_code, name, phone, commission')
          .in('referral_code', referralCodes);

        if (referralError) {
          console.error(
            'Supabase referral lookup error:',
            referralError,
          );

          return res.status(500).json({
            success: false,
            message: 'Failed to fetch referral details',
          });
        }

        const referralMap = new Map(
          (referrals ?? []).map((referral) => [
            referral.referral_code,
            referral,
          ]),
        );

        orders = orders.map((order) => {
          if (!order.referral_code) {
            return order;
          }

          const referral = referralMap.get(
            order.referral_code,
          );

          if (!referral) {
            return {
              ...order,
              referral: null,
            };
          }

          return {
            ...order,
            referral: {
              name: referral.name,
              phone: referral.phone,
              commission: referral.commission,
            },
          };
        });
      }
    }

    const total = count ?? 0;
    const totalPages =
      total === 0
        ? 0
        : Math.ceil(total / parsedLimit);

    return res.status(200).json({
      success: true,
      orders,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        totalPages,
        hasNextPage: parsedPage < totalPages,
        hasPrevPage: parsedPage > 1,
      },
    });
  } catch (error) {
    console.error('Get orders error:', error);

    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const assignElectrician = async (
  req: Request,
  res: Response,
) => {
  try {
    const { orderId } = req.params;
    const { electricianId } = req.body;

    if (typeof orderId !== 'string' || !orderId) {
  return res.status(400).json({
    success: false,
    message: 'Invalid order ID',
  });
}
    if (typeof electricianId !== 'string' || !electricianId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid electrician ID',
      });
    }

    // Check order
    const {
      data: order,
      error: orderError,
    } = await supabase
      .from('orders')
      .select(
        'id, electrician_id, status, customer_name',
      )
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    // Check electrician
    const {
      data: electrician,
      error: electricianError,
    } = await supabase
      .from('users')
      .select('id, name')
      .eq('id', electricianId)
      .eq('role', 'electrician')
      .single();

    if (electricianError || !electrician) {
      return res.status(404).json({
        success: false,
        message: 'Electrician not found',
      });
    }

    // Assign electrician
    const {
      error: updateError,
    } = await supabase
      .from('orders')
      .update({
        electrician_id: electricianId,
        status: 'assigned',
      })
      .eq('id', orderId);

    if (updateError) {
      console.error(
        'Assign electrician error:',
        updateError,
      );

      return res.status(500).json({
        success: false,
        message: 'Failed to assign electrician',
      });
    }

    // Notification details
    const title = 'New Job Assigned';

    const message =
      `You have been assigned a new job by Admin.`;

    const type = 'job_assigned';

    // Create notification in database
    const {
      error: notificationError,
    } = await supabase
      .from('notifications')
      .insert({
        electrician_id: electricianId,
        order_id: orderId,
        title,
        message,
        type,
        is_read: false,
      });

    if (notificationError) {
      console.error(
        'Notification creation error:',
        notificationError,
      );

      // Assignment succeeded,
      // so don't fail the request.
    }

    // Send Web Push notification
    await sendJobAssignedNotification({
      electricianId,
      title,
      message,
      type,
      orderId,
    });

    return res.status(200).json({
      success: true,
      message: 'Electrician assigned successfully',
    });
  } catch (error) {
    console.error(
      'Assign electrician error:',
      error,
    );

    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const orderCompleted = async (
  req: Request,
  res: Response,
) => {
  try {
    const { orderId } = req.params;
    const {
      mode_of_payment,
      payment_details,
    } = req.body;

    if (typeof orderId !== 'string' || !orderId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID',
      });
    }

    // Check if order exists
    const {
      data: order,
      error: orderError,
    } = await supabase
      .from('orders')
      .select('id, status')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    // Prevent completing an already completed order
    if (order.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Order is already completed',
      });
    }

    if (
      mode_of_payment !== 'cash' &&
      mode_of_payment !== 'UPI'
    ) {
      return res.status(400).json({
        success: false,
        message: 'mode_of_payment must be either cash or UPI',
      });
    }

    if (
      !Array.isArray(payment_details) ||
      payment_details.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: 'payment_details must contain at least one item',
      });
    }

    const hasInvalidPayment = payment_details.some(
      (payment) =>
        !payment ||
        typeof payment !== 'object' ||
        typeof payment.description !== 'string' ||
        !payment.description.trim() ||
        (typeof payment.amount !== 'number' &&
          typeof payment.amount !== 'string') ||
        payment.amount === '' ||
        Number.isNaN(Number(payment.amount)) ||
        Number(payment.amount) < 0,
    );

    if (hasInvalidPayment) {
      return res.status(400).json({
        success: false,
        message:
          'Each payment detail must include description and a valid amount',
      });
    }

    const totalAmount = payment_details.reduce(
      (total: number, payment: { amount: number | string }) =>
        total + Number(payment.amount),
      0,
    );

    // Update order status
    const {
      data,
      error: updateError,
    } = await supabase
      .from('orders')
      .update({
        status: 'completed',
        mode_of_payment: mode_of_payment,
        payment_details: payment_details,
        total_amount: totalAmount,
      })
      .eq('id', orderId)
      .select(
        'id, status, mode_of_payment, payment_details, total_amount',
      )
      .single();

    if (updateError) {
      console.error(
        'Complete order error:',
        updateError,
      );

      return res.status(500).json({
        success: false,
        message: 'Failed to complete order',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Order completed successfully',
      order: data,
    });
  } catch (error) {
    console.error(
      'Order completed error:',
      error,
    );

    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};