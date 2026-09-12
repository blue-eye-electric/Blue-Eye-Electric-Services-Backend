import { Router } from 'express';
import {
	createServiceArea,
	getServiceArea,
	updateServiceArea,
} from '../controllers/serviceAreaController';
import { requireAdmin } from '../middleware/roleCheckMiddleware';

const router = Router();

router.get('/service-areas', getServiceArea);
router.post('/service-areas', requireAdmin, createServiceArea);
router.patch('/service-areas/:id', requireAdmin, updateServiceArea);

export default router;
