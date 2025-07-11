import express from 'express';
import { uploadVideo, uploadIcon, uploadImages } from '../controllers/videoController.js';

const router = express.Router();

router.post('/upload-video', uploadVideo);
router.post('/upload-icon', uploadIcon);
router.post('/upload-images', uploadImages);

export default router; 