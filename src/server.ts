import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';

import orderRoutes from './routes/orderRoutes';
import electricianRoutes from './routes/electricianRoutes';
import adminRoutes from './routes/adminRoutes';
import serviceAreaRoutes from './routes/serviceAreaRoutes';
import referralRoutes from './routes/referralRoutes';
import {
  forgotPassword,
  loginUser,
  validateToken,
} from './controllers/authController';
import { deleteExpiredOrderPhotos } from './helpers/deleteExpiredOrderPhotos';

const app = express();

const allowedOrigins = [
  // 'http://localhost:5173',
  'https://www.blueeyeelectric.com',
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests without origin
      // such as Postman/server-to-server requests
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }),
);

app.use(express.json());

app.post('/api/auth/login', loginUser);
app.post('/api/auth/forgot-password', forgotPassword);
app.get('/api/auth/validate-token', validateToken);

app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'BlueEye Backend is running',
  });
});

app.use('/api', orderRoutes);
app.use('/api', electricianRoutes);
app.use('/api', adminRoutes);
app.use('/api', serviceAreaRoutes);
app.use('/api', referralRoutes);

const PORT = Number(process.env.PORT) || 4000;

cron.schedule('0 2 * * *', async () => {
  try {
    await deleteExpiredOrderPhotos();
    console.log('Expired order photos cleanup completed');
  } catch (error) {
    console.error('Expired order photos cleanup failed:', error);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});