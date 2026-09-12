import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { getDrivingDistances } from '../services/openRouteService';

export const findDistance = async (
  req: Request,
  res: Response,
) => {
  try {
    const { orderId } = req.query;

    if (!orderId || typeof orderId !== 'string') {
      return res.status(400).json({
        message: 'orderId is required',
      });
    }

    // 1. Get order
    const {
      data: order,
      error: orderError,
    } = await supabase
      .from('orders')
      .select('id, latitude, longitude, service_area')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return res.status(404).json({
        message: 'Order not found',
      });
    }

    // 2. Validate order location
    if (
      order.latitude == null ||
      order.longitude == null
    ) {
      return res.status(400).json({
        message:
          'Order does not have latitude and longitude',
      });
    }

    // 3. Get all electricians
    const {
      data: electricians,
      error: electricianError,
    } = await supabase
      .from('users')
      .select(
        'id, name, latitude, longitude, status',
      )
      .eq('service_area', order.service_area)
      .eq('role', 'electrician')
      .eq('status','approved')
      .not('latitude', 'is', null)
      .not('longitude', 'is', null);

    if (electricianError) {
      console.error(electricianError);

      return res.status(500).json({
        message:
          'Failed to fetch electricians',
      });
    }

    if (!electricians?.length) {
      return res.status(200).json({
        orderId,
        electricians: [],
      });
    }

    // 4. Prepare electrician coordinates
    const electricianCoordinates =
      electricians.map((electrician) => ({
        latitude: Number(
          electrician.latitude,
        ),
        longitude: Number(
          electrician.longitude,
        ),
      }));

    // 5. Get road distances from ORS
    const matrix =
      await getDrivingDistances(
        {
          latitude: Number(order.latitude),
          longitude: Number(order.longitude),
        },
        electricianCoordinates,
      );

    const distances =
      matrix.distances?.[0] ?? [];

    const durations =
      matrix.durations?.[0] ?? [];

    // 6. Combine electrician + distance
    const result = electricians
      .map((electrician, index) => ({
        id: electrician.id,
        name: electrician.name,
        distanceKm: distances[index],
        durationMinutes:
          durations[index] != null
            ? Math.ceil(
                durations[index] / 60,
              )
            : null,
      }))
      .filter(
        (electrician) =>
          electrician.distanceKm != null,
      )
      .sort(
        (a, b) =>
          a.distanceKm -
          b.distanceKm,
      );

    return res.status(200).json({
      orderId,
      electricians: result,
    });
  } catch (error) {
    console.error(
      'findDistance error:',
      error,
    );

    return res.status(500).json({
      message:
        'Failed to calculate electrician distances',
    });
  }
};