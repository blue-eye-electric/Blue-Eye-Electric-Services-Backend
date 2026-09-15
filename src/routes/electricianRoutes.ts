import { Router } from 'express';


import { loginAs } from '../controllers/authController';

import {
  savePushSubscription,
  getVapidPublicKey,
  updateElectrician,
} from '../controllers/electricianController';

import {
  authenticate,
} from '../middleware/authMiddleware';
import {
  getElectricians,
  getElectricianForOrder,
  createElectrician,
} from '../controllers/electricianController';
import { requireAdmin } from '../middleware/roleCheckMiddleware';
import upload from '../middleware/uploadMiddleware';

const router = Router();

router.get('/electricians',requireAdmin, getElectricians);

router.get(
  '/electricians/order/:orderId',
  requireAdmin,
  getElectricianForOrder,
);

router.patch(
  '/electricians/:id',
  requireAdmin,
  upload.fields([
    {
      name: "profilePhoto",
      maxCount: 1,
    },
    {
      name: "validId",
      maxCount: 1,
    },
    {
      name: "addressProof",
      maxCount: 1,
    },
    {
      name: "bankAccountProof",
      maxCount: 1,
    },
  ]),
  updateElectrician,
);

router.post('/electricians',upload.fields([
    { name: "profilePhoto", maxCount: 1 },
    { name: "validId", maxCount: 1 },
    { name: "addressProof", maxCount: 1 },
    { name: "bankAccountProof", maxCount: 1 },
  ]), createElectrician);

router.post(
  '/electrician/login',
  loginAs('electrician'),
);

router.get(
  '/electrician/push-public-key',
  getVapidPublicKey,
);

router.post(
  '/electrician/push-subscription',
  authenticate,
  savePushSubscription,
);

export default router;