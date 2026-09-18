import { randomInt } from 'crypto';
import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

const REFERRAL_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const REFERRAL_CODE_LENGTH = 6;
const MAX_INSERT_ATTEMPTS = 5;

const generateReferralCode = (): string => {
  let code = '';

  for (let index = 0; index < REFERRAL_CODE_LENGTH; index += 1) {
    code += REFERRAL_CODE_ALPHABET[randomInt(REFERRAL_CODE_ALPHABET.length)];
  }

  return code;
};

export const createReferral = async (req: Request, res: Response) => {
  try {
    const name = String(req.body.name ?? '').trim();
    const phone = String(req.body.phone ?? '').trim();

    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Name and phone are required',
      });
    }

    const { data: existingReferral, error: lookupError } = await supabase
      .from('referrals')
      .select('name, phone, referral_code, commission')
      .eq('phone', phone)
      .maybeSingle();

    if (lookupError) {
      console.error('Supabase find referral error:', lookupError);

      return res.status(500).json({
        success: false,
        message: 'Failed to find referral',
      });
    }

    if (existingReferral) {
      return res.status(200).json({
        success: true,
        referral: {
          name: existingReferral.name,
          phone: existingReferral.phone,
          referralCode: existingReferral.referral_code,
        //   commission: existingReferral.commission,
        },
      });
    }

    for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt += 1) {
      const referralCode = generateReferralCode();
      const { data, error } = await supabase
        .from('referrals')
        .insert({
          name,
          phone,
          referral_code: referralCode,
        })
        .select('name, phone, referral_code, commission')
        .single();

      if (!error) {
        return res.status(201).json({
          success: true,
          referral: {
            name: data.name,
            phone: data.phone,
            referralCode: data.referral_code,
            // commission: data.commission,
          },
        });
      }

      if (error.code !== '23505') {
        console.error('Supabase create referral error:', error);

        return res.status(500).json({
          success: false,
          message: 'Failed to create referral',
        });
      }

      const { data: referralForPhone, error: phoneLookupError } =
        await supabase
          .from('referrals')
          .select('name, phone, referral_code, commission')
          .eq('phone', phone)
          .maybeSingle();

      if (phoneLookupError) {
        console.error('Supabase find referral after conflict error:', phoneLookupError);
      }

      if (referralForPhone) {
        return res.status(200).json({
          success: true,
          referral: {
            name: referralForPhone.name,
            phone: referralForPhone.phone,
            referralCode: referralForPhone.referral_code,
            // commission: referralForPhone.commission,
          },
        });
      }
    }

    return res.status(503).json({
      success: false,
      message: 'Could not generate a unique referral code',
    });
  } catch (error) {
    console.error('Create referral error:', error);

    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};


export const getReferrals = async (req: Request, res: Response) => {
  try {
    const { page, limit, search } = req.query;

    const parsedPage = Number(Array.isArray(page) ? page[0] : page ?? 1);
    const parsedLimit = Number(Array.isArray(limit) ? limit[0] : limit ?? 20);

    if (!Number.isInteger(parsedPage) || parsedPage < 1) {
      return res.status(400).json({
        success: false,
        message: 'Page must be a positive integer',
      });
    }

    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      return res.status(400).json({
        success: false,
        message: 'Limit must be between 1 and 100',
      });
    }

    const offset = (parsedPage - 1) * parsedLimit;

    // Build query with total count
    let query = supabase
      .from('referrals')
      .select('name, phone, referral_code, commission, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + parsedLimit - 1);

    // Optional search filter by name, phone, or referral code
    if (typeof search === 'string' && search.trim() !== '') {
      const searchTerm = `%${search.trim()}%`;
      query = query.or(
        `name.ilike.${searchTerm},phone.ilike.${searchTerm},referral_code.ilike.${searchTerm}`
      );
    }

    const { data, error, count } = await query;

    if (error) {
      console.error('Supabase get referrals error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch referrals',
      });
    }

    const total = count ?? 0;
    const totalPages = total === 0 ? 0 : Math.ceil(total / parsedLimit);

    const referrals = (data ?? []).map((referral) => ({
      name: referral.name,
      phone: referral.phone,
      referralCode: referral.referral_code,
      commission: referral.commission,
      createdAt: referral.created_at,
    }));

    return res.status(200).json({
      success: true,
      referrals,
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
    console.error('Get referrals error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};


export const updateReferral = async (req: Request, res: Response) => {
    const { phone } = req.params;

  try {
    const { name, commission } = req.body;

    // Ensure identifier is provided
    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone is required to update a referral',
      });
    }

    const updates: Record<string, any> = {};

    // Validate and build name update
    if (name !== undefined) {
      const trimmedName = String(name).trim();
      if (!trimmedName) {
        return res.status(400).json({
          success: false,
          message: 'Name cannot be empty',
        });
      }
      updates.name = trimmedName;
    }

    // Validate and build commission update (0 to 100)
    if (commission !== undefined) {
      const parsedCommission = Number(commission);
      if (
        isNaN(parsedCommission) ||
        parsedCommission < 0 ||
        parsedCommission > 100
      ) {
        return res.status(400).json({
          success: false,
          message: 'Commission must be a number between 0 and 100',
        });
      }
      updates.commission = parsedCommission;
    }

    // Check if there is anything to update
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one field (name or commission) must be provided to update',
      });
    }

    // Build update query targeting id or phone
    let query = supabase.from('referrals').update(updates);

    
    query = query.eq('phone', String(phone).trim());
    

    const { data, error } = await query
      .select('name, phone, referral_code, commission, updated_at')
      .maybeSingle();

    if (error) {
      console.error('Supabase update referral error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update referral',
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Referral not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Referral updated successfully',
      referral: {
        name: data.name,
        phone: data.phone,
        referralCode: data.referral_code,
        commission: data.commission,
        updatedAt: data.updated_at,
      },
    });
  } catch (error) {
    console.error('Update referral error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};