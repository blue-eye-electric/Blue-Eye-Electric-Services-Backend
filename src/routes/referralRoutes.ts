import { Router } from 'express';
import { createReferral } from '../controllers/referralController';

const router = Router();

router.post('/referrals', createReferral);

export default router;