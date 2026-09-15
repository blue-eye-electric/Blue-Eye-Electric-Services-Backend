import multer from "multer";

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
    files: 5,
  },

  fileFilter: (_req, file, cb) => {
    const profilePhotoTypes = [
      "image/jpeg",
      "image/png",
    ];

    const proofTypes = [
      "image/jpeg",
      "image/png",
      "application/pdf",
    ];

    if (file.fieldname === "profilePhoto") {
      if (!profilePhotoTypes.includes(file.mimetype)) {
        return cb(
          new Error(
            "Profile photo must be JPG, JPEG,HEIC, HEIF or PNG.",
          ),
        );
      }
    }

    if (file.fieldname === "validId") {
      if (!proofTypes.includes(file.mimetype)) {
        return cb(
          new Error(
            "Valid ID must be JPG, JPEG, PNG, HEIC, HEIF or PDF.",
          ),
        );
      }
    }

    if (
      file.fieldname === "addressProof" ||
      file.fieldname === "bankAccountProof"
    ) {
      if (!proofTypes.includes(file.mimetype)) {
        return cb(
          new Error(
            "Address and bank account proofs must be JPG, JPEG, PNG or PDF.",
          ),
        );
      }
    }

    if (file.fieldname === "orderPhotos" || file.fieldname === "photos") {
      if (!profilePhotoTypes.includes(file.mimetype)) {
        return cb(
          new Error(
            "Order photos must be JPG, JPEG, HEIC, HEIF or PNG.",
          ),
        );
      }
    }

    cb(null, true);
  },
});

export default upload;