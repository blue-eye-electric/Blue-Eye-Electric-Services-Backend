import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { AuthRequest } from '../middleware/authMiddleware';
import { saveLatestPushSubscription } from '../services/userAuth';
import { getStoragePathFromUrl } from '../helpers/getStoragePathFromUrl';
import { fileExistsInBucket } from '../helpers/fileExistsInBucket';

export const getElectricians = async (
  req: Request,
  res: Response,
) => {
  try {
    const { id, status, withDocument } = req.query;

    let query = supabase
      .from('users')
      .select(`
        id,
        name,
        email,
        mobile_number,
        current_address,
        service_area,
        latitude,
        longitude,
        profile_photo_url,
        valid_id_url,
        valid_id_number,
        valid_id_type,
        status,
        created_at,
        updated_at
      `)
      .eq('role', 'electrician');

    // Filter by ID if provided
    if (id) {
      query = query.eq('id', id as string);
    }

    // Filter by status if provided
    if (status) {
      query = query.eq('status', status as string);
    }

    const { data, error } = await query.order('created_at', {
      ascending: false,
    });

    if (error) {
      console.error(
        'Supabase get electricians error:',
        error,
      );

      return res.status(500).json({
        success: false,
        message: 'Failed to fetch electricians',
      });
    }

    // Generate signed document URLs only when requested
    if (withDocument === 'true') {
      const electricians = await Promise.all(
        (data ?? []).map(async (electrician) => {
          let documentUrl: string | null = null;

          if (electrician.valid_id_url) {
            const {
              data: signedUrlData,
              error: signedUrlError,
            } = await supabase.storage
              .from('documents/')
              .createSignedUrl(
                electrician.valid_id_url,
                60 * 60,
              );

            if (signedUrlError) {
              console.error(
                `Failed to create signed URL for electrician ${electrician.id}:`,
                signedUrlError,
              );
            } else {
              documentUrl = signedUrlData.signedUrl;
            }
          }

          return {
            ...electrician,
            valid_id_url: documentUrl,
          };
        }),
      );

      return res.status(200).json({
        success: true,
        electricians,
      });
    }

    return res.status(200).json({
      success: true,
      electricians: data,
    });
  } catch (error) {
    console.error(
      'Get electricians error:',
      error,
    );

    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getElectricianForOrder = async (
  req: Request,
  res: Response,
) => {
  try {
    const { orderId } = req.params;

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('service_area')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    if (!order.service_area) {
      return res.status(404).json({
        success: false,
        message: 'Order service area not found',
      });
    }

    const { data: electricians, error: electricianError } =
      await supabase
        .from('users')
        .select(`
          id,
          name,
          email,
          mobile_number,
          current_address,
          service_area,
          latitude,
          longitude,
          profile_photo_url,
          valid_id_url,
          valid_id_number,
          valid_id_type,
          status,
          created_at,
          updated_at
        `)
        .eq('role', 'electrician')
        .eq('status', 'approved')
        .eq('service_area', order.service_area)
        .order('created_at', { ascending: false });

    if (electricianError) {
      console.error(
        'Supabase get electricians for order error:',
        electricianError,
      );

      return res.status(500).json({
        success: false,
        message: 'Failed to fetch electricians for order',
      });
    }

    return res.status(200).json({
      success: true,
      serviceArea: order.service_area,
      electricians: electricians ?? [],
    });
  } catch (error) {
    console.error('Get electricians for order error:', error);

    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const createElectrician = async (
  req: Request,
  res: Response,
) => {
  try {
    const {
      name,
      email,
      mobileNumber,
      password,
      currentAddress,
      serviceArea,
      latitude,
      longitude,
      validIdNumber,
      validIdType,
    } = req.body;

    const normalizedMobileNumber = String(mobileNumber ?? '').trim();
    const normalizedEmail = String(email ?? '').trim().toLowerCase();
    const normalizedServiceArea = String(serviceArea ?? '').trim();
const files = req.files as {
      [fieldname: string]: Express.Multer.File[];
    };

    const profilePhoto = files?.profilePhoto?.[0];
    const validId = files?.validId?.[0];

    if (!profilePhoto) {
      return res.status(400).json({
        success: false,
        message: "Profile photo is required.",
      });
    }

    if (!validId) {
      return res.status(400).json({
        success: false,
        message: "Valid ID document is required.",
      });
    }

    // Validate required fields
    if (
      !name ||
      !normalizedEmail ||
      !mobileNumber ||
      !password ||
      !currentAddress ||
      !normalizedServiceArea ||
      latitude === undefined ||
      longitude === undefined ||
      !validIdNumber ||
      !validIdType
    ) {
      return res.status(400).json({
        success: false,
        message: 'Required fields are missing',
      });
    }

    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email address',
      });
    }

    // Validate password
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters',
      });
    }

    // Validate ID type
    const allowedIdTypes = [
      'aadhar_card',
      'driving_license',
      'voting_card',
      'passport'
    ];

    if (!allowedIdTypes.includes(validIdType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ID type',
      });
    }

    if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude must be valid numbers',
      });
    }

    const { data: existingElectrician, error: existingError } =
      await supabase
        .from('users')
        .select('id')
        .eq('mobile_number', normalizedMobileNumber)
        .eq('role', 'electrician')
        .maybeSingle();

    const { data: existingEmail, error: emailError } = await supabase
      .from('users')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (emailError) {
      console.error('Check electrician email error:', emailError);
      return res.status(500).json({
        success: false,
        message: 'Failed to check electrician email',
      });
    }

    if (existingEmail) {
      return res.status(409).json({
        success: false,
        message: 'This email address is already registered',
      });
    }

    if (existingError) {
      console.error('Check electrician error:', existingError);
      return res.status(500).json({
        success: false,
        message: 'Failed to check electrician',
      });
    }

    if (existingElectrician) {
      return res.status(409).json({
        success: false,
        message: 'Electrician with this mobile number already exists',
      });
    }


    const profileExtension =
      profilePhoto.originalname
        .split(".")
        .pop()
        ?.toLowerCase() || "jpg";

    const validIdExtension =
      validId.originalname
        .split(".")
        .pop()
        ?.toLowerCase() || "file";

    const profileFileName =
      `${crypto.randomUUID()}.${profileExtension}`;

    const validIdFileName =
      `${crypto.randomUUID()}.${validIdExtension}`;

    const profilePhotoPath =
      `electricians/${profileFileName}`;

    const validIdPath =
      `electricians/${validIdFileName}`;

    // ---------------------------------------
    // Upload profile photo
    // ---------------------------------------

    const {
      error: profileUploadError,
    } = await supabase.storage
      .from("profile")
      .upload(
        profilePhotoPath,
        profilePhoto.buffer,
        {
          contentType: profilePhoto.mimetype,
          upsert: false,
        },
      );

    if (profileUploadError) {
      console.error(
        "Profile photo upload error:",
        profileUploadError,
      );

      return res.status(500).json({
        success: false,
        message: "Failed to upload profile photo",
      });
    }

    // ---------------------------------------
    // Upload valid ID
    // ---------------------------------------

    const {
      error: validIdUploadError,
    } = await supabase.storage
      .from("documents")
      .upload(
        validIdPath,
        validId.buffer,
        {
          contentType: validId.mimetype,
          upsert: false,
        },
      );

    if (validIdUploadError) {
      console.error(
        "Valid ID upload error:",
        validIdUploadError,
      );

      // Remove profile photo if ID upload fails
      await supabase.storage
        .from("documents")
        .remove([profilePhotoPath]);

      return res.status(500).json({
        success: false,
        message: "Failed to upload identity document",
      });
    }


    const { data: authUser, error: authError } =
      await supabase.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true,
      });

    if (authError || !authUser.user) {
      console.error('Create electrician auth user error:', authError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create login account',
      });
    }

const { data:profilePhotoData } = supabase.storage
  .from("profile")
  .getPublicUrl(profilePhotoPath);

const profilePhotoUrl = profilePhotoData.publicUrl;

    const {
      data,
      error,
    } = await supabase
      .from('users')
      .insert({
        id: authUser.user.id,
        role: 'electrician',
        name,
        email: normalizedEmail,
        mobile_number: normalizedMobileNumber,
        current_address: currentAddress,
        service_area: normalizedServiceArea,
        latitude: Number(latitude),
        longitude: Number(longitude),
        profile_photo_url: profilePhotoUrl,
        valid_id_url: validIdPath,
        valid_id_number: validIdNumber,
        valid_id_type: validIdType,
        status: 'pending',
      })
      .select(`
        id,
        name,
        mobile_number,
        current_address,
        service_area,
        latitude,
        longitude,
        valid_id_url,
        valid_id_number,
        valid_id_type,
        status,
        created_at,
        updated_at
      `)
      .single();

    if (error) {
      await supabase.auth.admin.deleteUser(authUser.user.id);
      console.error(
        'Supabase create electrician error:',
        error,
      );

      return res.status(500).json({
        success: false,
        message: 'Failed to register electrician',
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Electrician registered successfully',
      electrician: data,
    });
  } catch (error) {
    console.error(
      'Create electrician error:',
      error,
    );

    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const updateElectrician = async (
  req: Request,
  res: Response,
) => {
  try {
    const { id } = req.params;

    /*
     * Get current electrician first
     */
    const { data: existingElectrician, error: fetchError } =
      await supabase
        .from("users")
        .select(`
          id,
          email,
          mobile_number,
          profile_photo_url,
          valid_id_url
        `)
        .eq("id", id)
        .eq("role", "electrician")
        .single();

    if (fetchError || !existingElectrician) {
      return res.status(404).json({
        success: false,
        message: "Electrician not found",
      });
    }

    /*
     * Fields admin cannot update
     */
    const restrictedFields = [
      "id",
      "email",
      "mobile_number",
      "role",
      "password",
    ];

    const updateData: Record<string, any> = {
      ...req.body,
    };

    restrictedFields.forEach((field) => {
      delete updateData[field];
    });

    /*
     * Allowed fields
     */
    const allowedFields = [
      "name",
      "current_address",
      "service_area",
      "latitude",
      "longitude",
      "valid_id_number",
      "valid_id_type",
      "status",
    ];

    const invalidFields = Object.keys(updateData).filter(
      (field) => !allowedFields.includes(field),
    );

    if (
      updateData.service_area !== undefined &&
      !String(updateData.service_area).trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Service area is required",
      });
    }

    if (invalidFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid fields: ${invalidFields.join(", ")}`,
      });
    }

    /*
     * Convert coordinates
     */
    if (updateData.latitude !== undefined) {
      updateData.latitude = Number(updateData.latitude);
    }

    if (updateData.longitude !== undefined) {
      updateData.longitude = Number(updateData.longitude);
    }

    /*
     * Uploaded files
     */
    const files = req.files as {
      [fieldname: string]: Express.Multer.File[];
    };

   /*
 * --------------------------------
 * PROFILE PHOTO
 * --------------------------------
 */
const profilePhoto = files?.profilePhoto?.[0];

if (profilePhoto) {
  let profilePath: string | null = null;

  /*
   * Try existing path first
   */
  if (existingElectrician.profile_photo_url) {
    const oldPath = getStoragePathFromUrl(
      existingElectrician.profile_photo_url,
      "profile/electricians",
      true,
    );

    if (oldPath) {
      const exists = await fileExistsInBucket(
        "profile",
        oldPath,
      );

      if (exists) {
        profilePath = oldPath;
      }
    }
  }

  /*
   * Existing file was not found.
   * Create a new path.
   */
  if (!profilePath) {
    const profileExtension =
      profilePhoto.originalname
        .split(".")
        .pop()
        ?.toLowerCase() || "jpg";

        const profileFileName =
      `${crypto.randomUUID()}.${profileExtension}`;
    profilePath =`electricians/${profileFileName}`;
  }

  const { error: uploadError } =
    await supabase.storage
      .from("profile")
      .upload(
        profilePath,
        profilePhoto.buffer,
        {
          contentType: profilePhoto.mimetype,
          upsert: true,
        },
      );

  if (uploadError) {
    console.error(
      "Profile photo upload error:",
      uploadError,
    );

    return res.status(500).json({
      success: false,
      message: "Failed to update profile photo",
    });
  }

  const { data: publicUrlData } =
    supabase.storage
      .from("profile")
      .getPublicUrl(profilePath);

  updateData.profile_photo_url =
    publicUrlData.publicUrl;
}

    /*
 * --------------------------------
 * VALID ID
 * --------------------------------
 */
const validId = files?.validId?.[0];

if (validId) {
  let validIdPath: string | null = null;

  /*
   * Try existing path first
   */
  if (existingElectrician.valid_id_url) {
    const oldPath = getStoragePathFromUrl(
      existingElectrician.valid_id_url,
      "documents/electricians",
      false,
    );

    if (oldPath) {
      const exists = await fileExistsInBucket(
        "documents",
        oldPath,
      );

      if (exists) {
        validIdPath = oldPath;
      }
    }
  }

  /*
   * Existing file was not found.
   * Create a new path.
   */
  if (!validIdPath) {
    const validIdExtension =
      validId.originalname
        .split(".")
        .pop()
        ?.toLowerCase() || "jpg";

        const validIdFileName =
      `${crypto.randomUUID()}.${validIdExtension}`;
        
    validIdPath =
      `electricians/${validIdFileName}`;
  }

  const { error: uploadError } =
    await supabase.storage
      .from("documents")
      .upload(
        validIdPath,
        validId.buffer,
        {
          contentType: validId.mimetype,
          upsert: true,
        },
      );

  if (uploadError) {
    console.error(
      "Valid ID upload error:",
      uploadError,
    );

    return res.status(500).json({
      success: false,
      message: "Failed to update valid ID",
    });
  }

  const { data: publicUrlData } =
    supabase.storage
      .from("documents")
      .getPublicUrl(validIdPath);

  updateData.valid_id_url =
    publicUrlData.publicUrl;
}

    /*
     * Nothing to update
     */
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No editable fields provided",
      });
    }

    updateData.updated_at =
      new Date().toISOString();

    /*
     * Update database
     */
    const { data, error } =
      await supabase
        .from("users")
        .update(updateData)
        .eq("id", id)
        .eq("role", "electrician")
        .select()
        .single();

    if (error) {
      console.error(
        "Update electrician error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to update electrician",
      });
    }

    return res.status(200).json({
      success: true,
      message:
        "Electrician updated successfully",
      electrician: data,
    });
  } catch (error) {
    console.error(
      "Update electrician error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const savePushSubscription = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const userId = req.user?.id;

    if (!userId || req.user?.role !== 'electrician') {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized',
      });
    }

    const { endpoint, keys } = req.body;

    if (
      !endpoint ||
      !keys?.p256dh ||
      !keys?.auth
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid push subscription',
      });
    }

    const { data, error } = await saveLatestPushSubscription(
      userId,
      { endpoint, keys },
    );

    if (error) {
      console.error(
        'Save push subscription error:',
        error,
      );

      return res.status(500).json({
        success: false,
        message: 'Failed to save push subscription',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Push subscription saved successfully',
      user: req.user,
      subscription: data,
    });
  } catch (error) {
    console.error(
      'Push subscription error:',
      error,
    );

    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getVapidPublicKey = (
  req: Request,
  res: Response,
) => {
  return res.status(200).json({
    success: true,
    publicKey: process.env.VAPID_PUBLIC_KEY,
  });
};