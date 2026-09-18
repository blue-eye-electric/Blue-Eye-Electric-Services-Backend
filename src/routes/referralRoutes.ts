import { Router } from 'express';
import { createReferral, getReferrals, updateReferral } from '../controllers/referralController';
import { requireAdmin } from '../middleware/roleCheckMiddleware';

const router = Router();

router.post('/referrals', createReferral);
router.get('/referrals', requireAdmin, getReferrals);
router.patch('/referrals/:phone', requireAdmin, updateReferral);

export default router;