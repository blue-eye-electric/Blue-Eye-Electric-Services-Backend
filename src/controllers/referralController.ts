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