import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

export const getServiceArea = async (
	req: Request,
	res: Response,
) => {
	try {
		const { data, error } = await supabase
			.from('service_areas')
			.select('*');

		if (error) {
			console.error('Supabase get service areas error:', error);

			return res.status(500).json({
				success: false,
				message: 'Failed to fetch service areas',
			});
		}

		return res.status(200).json({
			success: true,
			serviceAreas: data ?? [],
		});
	} catch (error) {
		console.error('Get service areas error:', error);

		return res.status(500).json({
			success: false,
			message: 'Internal server error',
		});
	}
};

export const createServiceArea = async (
	req: Request,
	res: Response,
) => {
	try {
		const serviceArea = String(req.body.serviceArea ?? '').trim();

		if (!serviceArea) {
			return res.status(400).json({
				success: false,
				message: 'Service area is required',
			});
		}

		const { data, error } = await supabase
			.from('service_areas')
			.insert({ area_name: serviceArea })
			.select('*')
			.single();

		if (error) {
			console.error('Supabase create service area error:', error);

			return res.status(500).json({
				success: false,
				message: 'Failed to create service area',
			});
		}

		return res.status(201).json({
			success: true,
			serviceArea: data,
		});
	} catch (error) {
		console.error('Create service area error:', error);

		return res.status(500).json({
			success: false,
			message: 'Internal server error',
		});
	}
};

export const updateServiceArea = async (
	req: Request,
	res: Response,
) => {
	try {
		const { id } = req.params;
		const serviceArea = String(req.body.serviceArea ?? '').trim();

		if (!serviceArea) {
			return res.status(400).json({
				success: false,
				message: 'Service area is required',
			});
		}

		const { data, error } = await supabase
			.from('service_areas')
			.update({ area_name: serviceArea })
			.eq('id', id)
			.select('*')
			.single();

		if (error) {
			console.error('Supabase update service area error:', error);

			return res.status(500).json({
				success: false,
				message: 'Failed to update service area',
			});
		}

		return res.status(200).json({
			success: true,
			serviceArea: data,
		});
	} catch (error) {
		console.error('Update service area error:', error);

		return res.status(500).json({
			success: false,
			message: 'Internal server error',
		});
	}
};
