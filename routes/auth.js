const express = require("express");
const { protectRoute } = require("../middleware/auth");
const authController = require("../controllers/authController");

const router = express.Router();

router.post("/signup", authController.signup);
router.post("/login", authController.login);
router.post("/forgot-password", authController.forgotPassword);
router.post("/reset-password", authController.resetPassword);
router.get("/me", protectRoute, authController.getMe);
router.put("/profile", protectRoute, authController.updateProfile);

module.exports = router;
