const express = require("express");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const cors = require("cors");
const path = require("path");
const session = require("express-session");
require("dotenv").config();

const app = express();

// ----------------- MIDDLEWARE -----------------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "smarttrack-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 2 },
  })
);

// ----------------- DATABASE -----------------
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 50000,
      socketTimeoutMS: 45000,
    });
    console.log("✅ MongoDB Connected to Atlas");
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err);
    process.exit(1);
  }
};

connectDB();

// ----------------- SCHEMAS -----------------
const stockSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  qty: { type: Number, required: true, default: 0 },
});
const Stock = mongoose.model("Stock", stockSchema);

const staffSchema = new mongoose.Schema({
  name: String,
  phone: String,
  email: String,
  username: String,
  password: String,
});
const Staff = mongoose.model("Staff", staffSchema);

const stockLogSchema = new mongoose.Schema({
  productName: String,
  operation: String,
  amount: Number,
  staffName: { type: String, default: "Unknown Staff" },
  timestamp: { type: Date, default: Date.now },
});
const StockLog = mongoose.model("StockLog", stockLogSchema);

// ✅ ADD ENQUIRY SCHEMA
const enquirySchema = new mongoose.Schema({
  type: { type: String, required: true }, // 'low_stock' or 'staff_enquiry'
  staffName: String,
  staffEmail: String,
  staffUsername: String,
  productName: String,
  quantity: Number,
  message: String,
  currentStock: Number, // For low stock alerts
  timestamp: { type: Date, default: Date.now }
});
const Enquiry = mongoose.model("Enquiry", enquirySchema);

// ----------------- MIDDLEWARE -----------------
const requireAdminAuth = (req, res, next) => {
  if (req.session.admin) {
    next();
  } else {
    res.redirect("/admin-login");
  }
};

const requireStaffAuth = (req, res, next) => {
  if (req.session.username) {
    next();
  } else {
    res.redirect("/staff-login");
  }
};

// ----------------- NODEMAILER WITH BREVO SMTP -----------------
const createTransporter = () => {
  return nodemailer.createTransporter({
    host: "smtp-relay.brevo.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.BREVO_SMTP_USER, // Your Brevo SMTP username
      pass: process.env.BREVO_SMTP_KEY   // Your Brevo SMTP password
    },
    debug: true,
    logger: true
  });
};

// ----------------- EMAIL FUNCTIONS -----------------
const sendEmail = async (mailOptions) => {
  try {
    const transporter = createTransporter();
    
    console.log("📧 Attempting to send email via Brevo SMTP...");
    console.log(`From: ${mailOptions.from}`);
    console.log(`To: ${mailOptions.to}`);
    console.log(`Subject: ${mailOptions.subject}`);
    
    // Verify transporter configuration
    await transporter.verify();
    console.log("✅ Email transporter is ready");
    
    const result = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent successfully: ${result.messageId}`);
    console.log(`Response: ${result.response}`);
    return { success: true, messageId: result.messageId, response: result.response };
  } catch (error) {
    console.error("❌ Email sending failed:", error);
    return { success: false, error: error.message };
  }
};

const sendLowStockAlert = async (staffUsername, productName, currentQty, operationAmount) => {
  try {
    // Get staff details
    const staff = await Staff.findOne({ username: staffUsername });
    if (!staff) {
      console.log("Staff not found for low stock alert");
      return;
    }

    // ✅ STORE LOW STOCK ALERT IN DATABASE
    const lowStockEnquiry = new Enquiry({
      type: 'low_stock',
      staffName: staff.name,
      staffEmail: staff.email,
      staffUsername: staff.username,
      productName: productName,
      quantity: operationAmount,
      currentStock: currentQty,
      message: `Low stock alert: ${productName} is now at ${currentQty}kg after reduction of ${operationAmount}kg`
    });
    await lowStockEnquiry.save();
    console.log("✅ Low stock alert stored in database");

    const currentDate = new Date().toLocaleString();
    
    const mailOptions = {
      from: `"SmartTrack Alert System" <${process.env.EMAIL_USER}>`,
      to: process.env.ADMIN_EMAIL,
      subject: `🚨 LOW STOCK ALERT: ${productName} below 200kg`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #e74c3c; text-align: center;">🚨 LOW STOCK ALERT</h2>
          <div style="background: #f8f9fa; padding: 20px; border-radius: 10px; border-left: 4px solid #e74c3c;">
            <h3 style="color: #2c3e50; margin-top: 0;">Product: ${productName}</h3>
            <p style="margin: 8px 0;"><strong>📊 Current Quantity:</strong> ${currentQty} kg</p>
            <p style="margin: 8px 0;"><strong>📉 Reduced By:</strong> ${operationAmount} kg</p>
            <p style="margin: 8px 0;"><strong>⚠️ Status:</strong> ${currentQty < 100 ? 'CRITICALLY LOW' : 'LOW STOCK'}</p>
            <hr style="border: none; border-top: 1px solid #ddd;">
            <p style="margin: 8px 0;"><strong>👤 Staff Name:</strong> ${staff.name}</p>
            <p style="margin: 8px 0;"><strong>📧 Staff Email:</strong> ${staff.email}</p>
            <p style="margin: 8px 0;"><strong>👨‍💼 Staff Username:</strong> ${staff.username}</p>
            <hr style="border: none; border-top: 1px solid #ddd;">
            <p style="margin: 8px 0;"><strong>🕐 Time & Date:</strong> ${currentDate}</p>
          </div>
          <div style="text-align: center; margin-top: 20px; color: #7f8c8d;">
            <p>This is an automated alert from SmartTrack Inventory System</p>
          </div>
        </div>
      `
    };

    const emailResult = await sendEmail(mailOptions);
    if (emailResult.success) {
      console.log(`✅ Low stock alert email sent for ${productName} (${currentQty}kg)`);
    } else {
      console.error(`❌ Failed to send low stock alert email: ${emailResult.error}`);
    }
    
  } catch (error) {
    console.error("❌ Error in sendLowStockAlert:", error);
  }
};

// ... (KEEP ALL YOUR EXISTING ROUTES EXACTLY AS THEY ARE)

// ----------------- STAFF REGISTER -----------------
app.post("/api/staff/register", async (req, res) => {
  try {
    const { name, phone, email, username, password } = req.body;
    
    // Check if staff already exists
    const existing = await Staff.findOne({ $or: [{ email }, { username }] });
    if (existing) {
      return res.status(400).json({ success: false, message: "Staff with this email or username already exists." });
    }

    const staff = new Staff({ name, phone, email, username, password });
    await staff.save();
    console.log("✅ Staff registered and saved to database");

    // Send email with credentials
    const mailOptions = {
      from: `"SmartTrack Admin" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Your Staff Credentials - SmartTrack",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2c3e50; text-align: center;">Welcome to SmartTrack!</h2>
          <div style="background: #f8f9fa; padding: 20px; border-radius: 10px; border-left: 4px solid #007bff;">
            <h3 style="color: #2c3e50; margin-top: 0;">Your Staff Account Details</h3>
            <p style="margin: 8px 0;"><strong>👤 Name:</strong> ${name}</p>
            <p style="margin: 8px 0;"><strong>📧 Email:</strong> ${email}</p>
            <p style="margin: 8px 0;"><strong>👨‍💼 Username:</strong> ${username}</p>
            <p style="margin: 8px 0;"><strong>🔑 Password:</strong> ${password}</p>
            <hr style="border: none; border-top: 1px solid #ddd;">
            <p style="margin: 8px 0;"><strong>🔗 Login URL:</strong> ${req.headers.origin}/staff-login</p>
            <div style="background: #e7f3ff; padding: 10px; border-radius: 5px; margin-top: 15px;">
              <p style="margin: 0; color: #0056b3; font-weight: bold;">Keep these credentials secure and do not share them with anyone.</p>
            </div>
          </div>
          <div style="text-align: center; margin-top: 20px; color: #7f8c8d;">
            <p>SmartTrack Inventory Management System</p>
          </div>
        </div>
      `
    };

    const emailResult = await sendEmail(mailOptions);
    if (emailResult.success) {
      console.log("✅ Staff credentials email sent successfully");
      res.json({ success: true, message: "Staff registered & credentials sent to email!" });
    } else {
      console.error("❌ Failed to send staff credentials email:", emailResult.error);
      res.json({ 
        success: true, 
        message: "Staff registered but failed to send email. Please provide credentials manually." 
      });
    }
  } catch (err) {
    console.error("Registration Error:", err);
    res.status(500).json({ success: false, message: "Server error during registration" });
  }
});

// ... (KEEP ALL OTHER ROUTES THE SAME)

// ----------------- SERVER START -----------------
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📧 Email User: ${process.env.EMAIL_USER}`);
  console.log(`👤 Admin Email: ${process.env.ADMIN_EMAIL}`);
});
