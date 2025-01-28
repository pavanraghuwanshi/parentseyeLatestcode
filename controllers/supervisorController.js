const Child = require("../models/child");
const Supervisor = require("../models/supervisor");
const Attendance = require('../models/attendence');
const Geofencing = require('../models/geofence');
const Branch = require('../models/branch');
const { generateToken} = require("../jwt");
const School = require("../models/school");
const { formatDateToDDMMYYYY,formatTime } = require('../utils/dateUtils');
const Device = require('../models/device');
const Parent = require('../models/Parent');
const { sendNotificationToParent } = require('../utils/notificationsUtils'); 

exports.getSchools =  async (req, res) => {
  try {
    // Fetch schools and populate their branches
    const schools = await School.find().populate('branches').exec();

    // Format the response
    const response = schools.map(school => {
      return {
        schoolName: school.schoolName,
        branches: school.branches.map(branch => ({
          branchName: branch.branchName // Extract branch names
        }))
      };
    });

    res.status(200).json({ schools: response });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
exports.getDevices = async (req, res) => {
  try {
    const { schoolName, branchName } = req.query;

    // Validate that required fields are present
    if (!schoolName || !branchName) {
      return res.status(400).json({ error: 'School name and branch name are required' });
    }

    // Find the school by name
    const school = await School.findOne({ schoolName: new RegExp(`^${schoolName.trim()}$`, 'i') }).populate('branches');
    if (!school) {
      return res.status(404).json({ message: 'School not found' });
    }

    // Find the branch by name within the school
    const branch = school.branches.find(branch => branch.branchName.toLowerCase() === branchName.trim().toLowerCase());
    if (!branch) {
      return res.status(404).json({ message: 'Branch not found in the specified school' });
    }

    // Fetch all devices linked to the branch
    const devices = await Device.find({ branchId: branch._id }).lean();

    // Fetch all supervisors assigned to the branch and their devices
    const supervisors = await Supervisor.find({ branchId: branch._id }, 'deviceId').lean();

    // Get the deviceIds already assigned to supervisors
    const assignedDeviceIds = supervisors.map(supervisor => supervisor.deviceId);

    // Filter out devices that have already been assigned
    const availableDevices = devices.filter(device => !assignedDeviceIds.includes(device.deviceId));

    // Format the response to return only the available devices
    const response = availableDevices.map(device => ({
      deviceId: device.deviceId,
      deviceName: device.deviceName
    }));

    res.status(200).json({ devices: response });
  } catch (error) {
    console.error('Error fetching devices:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
exports.registerSupervisor = async (req, res) => {
  try {
    const {
      supervisorName,
      email,
      password,
      phone_no,
      address,
      deviceName,
      deviceId,
      schoolName,
      branchName // Expect branch in the request
    } = req.body;

    // Validate that required fields are present
    if (!schoolName || !branchName) {
      return res.status(400).json({ error: 'School name and branch name are required' });
    }

    // Check if supervisor email already exists
    const existingSupervisor = await Supervisor.findOne({ email });
    if (existingSupervisor) {
      return res.status(400).json({ error: 'Supervisor email already exists' });
    }

    // Find the school by name
    const school = await School.findOne({ schoolName: new RegExp(`^${schoolName.trim()}$`, 'i') }).populate('branches');
    if (!school) {
      return res.status(400).json({ error: 'School not found' });
    }

    // Find the branch by name within the found school
    const branch = school.branches.find(branch => branch.branchName.toLowerCase() === branchName.trim().toLowerCase());
    if (!branch) {
      return res.status(400).json({ error: 'Branch not found in the specified school' });
    }

    // Create new supervisor with a pending status
    const newSupervisor = new Supervisor({
      supervisorName,
      email,
      password, // Password hashing should be handled in the schema or middleware
      phone_no,
      address,
      deviceName,
      deviceId,
      schoolId: school._id, // Link to the school's ID
      branchId: branch._id,  // Link to the branch's ID
      statusOfRegister: 'pending'
    });
    const response = await newSupervisor.save();

    // Generate JWT token with supervisor ID, email, schoolId, and branchId
    const payload = { id: response._id, email: response.email, schoolId: school._id, branchId: branch._id };
    const token = generateToken(payload);

    res.status(201).json({ 
      supervisor: { ...response.toObject(), password: undefined }, // Do not return the password in the response
      token 
    });
  } catch (error) {
    console.error('Error during supervisor registration:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
exports.loginSupervisor =  async (req, res) => {
  const { email, password } = req.body;

  try {
    // Find the supervisor by email
    const supervisor = await Supervisor.findOne({ email });

    // Check if supervisor exists
    if (!supervisor) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    // Compare provided password with stored hashed password
    const isMatch = await supervisor.comparePassword(password);

    // Check if password matches
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    // Check if the registration status is approved
    if (supervisor.statusOfRegister !== 'approved') {
      return res.status(400).json({ error: "Account not approved yet" });
    }

    // Generate JWT token with supervisor ID, email, and schoolId
    const token = generateToken({
      id: supervisor._id,
      email: supervisor.email,
      schoolId: supervisor.schoolId,
      branchId: supervisor.branchId
    });

    // Send success response with token
    res.status(200).json({
      success: true,
      message: "Login successful",
      token: token
    });
  } catch (err) {
    console.error('Error during login:', err);
    res.status(500).json({ error: "Server error" });
  }
}
exports.getSupervisordata = async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const schoolId = req.user.schoolId; // Ensure schoolId is attached to the request by jwtAuthMiddleware
    const branchId = req.query.branchId; // Get branchId from query parameters if provided

    console.log(`Fetching data for supervisor with ID: ${supervisorId}, School ID: ${schoolId}, and Branch ID: ${branchId}`);

    // Build query object based on provided parameters
    const query = { _id: supervisorId, schoolId: schoolId };
    if (branchId) {
      query.branchId = branchId;
    }

    // Fetch the supervisor data based on the query
    const supervisor = await Supervisor.findOne(query)
      .populate('schoolId', 'schoolName') // Populate related fields
      .populate('branchId', 'branchName'); // Populate related fields

    if (!supervisor) {
      return res.status(404).json({ error: "Supervisor not found or does not belong to this school/branch" });
    }

    // Create a simplified response object
    const response = {
      supervisorName: supervisor.supervisorName,
      address: supervisor.address,
      email: supervisor.email,
      phone_no: supervisor.phone_no,
      deviceId: supervisor.deviceId,
      deviceName: supervisor.deviceName,
      schoolName: supervisor.schoolId.schoolName, // Get schoolName from populated field
      branchName: supervisor.branchId.branchName, // Get branchName from populated field
      registrationDate: supervisor.registrationDate
    };

    // Return the simplified supervisor data
    res.status(200).json({ supervisor: response });
  } catch (error) {
    console.error("Error fetching supervisor data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
exports.updateSupervisor = async (req, res) => {
  try {
    const { supervisorName, address, phone, email } = req.body;
    const supervisorId = req.user.id;
    const schoolId = req.user.schoolId; // Ensure schoolId is attached to the request by jwtAuthMiddleware

    // Update supervisor details, ensuring they belong to the correct school
    const supervisor = await Supervisor.findOneAndUpdate(
      { _id: supervisorId, schoolId: schoolId },
      { supervisorName, address, phone, email },
      { new: true }
    );

    if (!supervisor) {
      return res.status(404).json({ error: "Supervisor not found or does not belong to this school" });
    }

    res.status(200).json({ message: "Supervisor details updated successfully", supervisor });
  } catch (error) {
    console.error("Error updating supervisor details:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
exports.getallChildren = async (req, res) => {
  try {
    const { deviceId } = req.query;
    const schoolId = req.user.schoolId; // Ensure schoolId is attached to the request by jwtAuthMiddleware

    if (!deviceId) {
      return res.status(400).json({ error: "device ID is required" });
    }

    // Find children by deviceId and schoolId
    const children = await Child.find({ deviceId, schoolId }).lean();
    console.log("Raw children data:", JSON.stringify(children, null, 2));

    const transformedChildren = children.map((child) => ({
      childId: child._id,
      childName: child.childName,
      class: child.class,
      section: child.section,
      pickupPoint: child.pickupPoint
    }));

    console.log(
      "Transformed children data:",
      JSON.stringify(transformedChildren, null, 2)
    );

    res.status(200).json({ children: transformedChildren });
  } catch (error) {
    console.error("Error fetching children:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
exports.addGeofence = async (req, res) => {
  try {
    const { name, area, deviceId, busStopTime} = req.body;
    if (!name || !area || !deviceId) {
      return res.status(400).json({ error: "Name, area, and device ID are required" });
    }

    const findForUnique = await Geofencing.findOne({ name, deviceId });
    console.log(findForUnique,"findForUnique")
    if (findForUnique) {

      return res.status(400).json({ error: 'Same name already exists for this deviceId choose another name' });
      }

    const newGeofencing = new Geofencing({
      name,
      area,
      deviceId,
      busStopTime
    });
    const savedGeofencing = await newGeofencing.save();
    res.status(201).json({ message: "Geofencing area created successfully", geofencing: savedGeofencing });
  } catch (error) {
    console.error("Error creating geofencing area:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
exports.deleteGeofence = async (req, res) => {
  try {
    const { id } = req.params;

    // Find and delete the geofencing area by ID
    const deletedGeofencing = await Geofencing.findByIdAndDelete(id);

    if (!deletedGeofencing) {
      return res.status(404).json({ error: "Geofencing area not found" });
    }

    res.status(200).json({ message: "Geofencing area deleted successfully" });
  } catch (error) {
    console.error("Error deleting geofencing area:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
exports.deleteSupervisor = async (req, res) => {
  try {
    // Extract supervisorId from the decoded JWT token (assuming it's attached to req.user)
    const supervisorId = req.user.id; // or req.user.supervisorId if that's how it's stored

    // Find the supervisor by ID
    const supervisor = await Supervisor.findById(supervisorId);
    if (!supervisor) {
      return res.status(404).json({ error: 'Supervisor not found' });
    }

    // Delete the supervisor
    await Supervisor.findByIdAndDelete(supervisorId);

    res.status(200).json({ message: 'Supervisor deleted successfully' });
  } catch (error) {
    console.error('Error during supervisor deletion:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
exports.markPickup = async (req, res) => {
  const { childId, isPresent } = req.body;
  const { schoolId, branchId } = req; // Get schoolId and branchId from the request

  if (typeof isPresent !== "boolean") {
    return res.status(400).json({ error: "Invalid input" });
  }

  const today = new Date();
  const formattedDate = formatDateToDDMMYYYY(today);
  const currentTime = formatTime(today);

  try {
    const child = await Child.findOne({ _id: childId, schoolId, branchId });

    if (!child) {
      return res.status(404).json({ error: "Child not found or does not belong to the current school/branch" });
    }

    // Find or create the attendance record for the child
    let attendanceRecord = await Attendance.findOne({ childId, date: formattedDate });

    if (!attendanceRecord) {
      attendanceRecord = new Attendance({
        childId,
        date: formattedDate,
        pickup: null,
        drop: null,
        schoolId,
        branchId,
      });
    }

    attendanceRecord.pickup = isPresent;
    attendanceRecord.pickupTime = isPresent ? currentTime : null;
    await attendanceRecord.save();

    const message = isPresent
      ? `Child marked as present for pickup on ${formattedDate} at ${currentTime}`
      : `Child marked as absent for pickup`;

    // Fetch parent info and send notification
    const parent = await Parent.findById(child.parentId);
    if (parent && parent.fcmToken) {
      const notificationMessage = isPresent
        ? `Your child has been picked up from school at ${currentTime}`
        : `Your child was marked absent for pickup today.`;

      // Send notification using the parent's FCM token
      await sendNotificationToParent(parent.fcmToken, "Pickup Status", notificationMessage);
    }

    res.status(200).json({ message });
  } catch (error) {
    console.error(`Error marking child for pickup:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};
exports.markDrop = async (req, res) => {
  const { childId, isPresent } = req.body;
  const { schoolId, branchId } = req;

  if (typeof isPresent !== "boolean") {
    return res.status(400).json({ error: "Invalid input" });
  }

  const today = new Date();
  const formattedDate = formatDateToDDMMYYYY(today);
  const currentTime = formatTime(today);

  try {
    const child = await Child.findOne({ _id: childId, schoolId, branchId });
    if (!child) {
      return res.status(404).json({ error: "Child not found or does not belong to this school/branch" });
    }

    let attendanceRecord = await Attendance.findOne({ childId, date: formattedDate });

    if (!attendanceRecord) {
      attendanceRecord = new Attendance({
        childId,
        date: formattedDate,
        pickup: null,
        drop: null,
        schoolId,
        branchId,
      });
    }

    attendanceRecord.drop = isPresent;
    attendanceRecord.dropTime = isPresent ? currentTime : null;
    await attendanceRecord.save();

    const message = isPresent
      ? `Child marked as present for drop on ${formattedDate} at ${currentTime}`
      : `Child marked as absent for drop`;

    // Fetch parent info and send notification
    const parent = await Parent.findById(child.parentId);
    if (parent && parent.fcmToken) {
      const notificationMessage = isPresent
        ? `Your child has been dropped off at ${currentTime}`
        : `Your child was marked absent for drop today.`;

      // Send notification using the parent's FCM token
      await sendNotificationToParent(parent.fcmToken, "Drop Status", notificationMessage);
    }

    res.status(200).json({ message });
  } catch (error) {
    console.error(`Error marking child for drop:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};
exports.getAttendanceRecord = async (req, res) => {
  const { childId } = req.params; // Get childId from the route parameters
  const { schoolId, branchId } = req; // Extract schoolId and branchId from the request
  const dateParam = req.query.date; // Get date from query parameters
  
  // Format the date if provided, or use today's date
  const today = new Date();
  const formattedDate = dateParam ? dateParam : formatDateToDDMMYYYY(today);

  try {
    const child = await Child.findOne({ _id: childId, schoolId, branchId });
    if (!child) {
      return res.status(404).json({ error: "Child not found or does not belong to this school/branch" });
    }

    // Find the attendance record for the child on the specified date
    const attendanceRecord = await Attendance.findOne({ childId, date: formattedDate });

    if (!attendanceRecord) {
      return res.status(404).json({ message: "No attendance record found for this date" });
    }

    res.status(200).json({
      childId: attendanceRecord.childId,
      pickup: attendanceRecord.pickup,
      drop: attendanceRecord.drop,
    });
  } catch (error) {
    console.error(`Error fetching attendance record:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
};
exports.importSupervisor = async (req, res) => {
  try {
    const data = req.body;
    const errors = [];
    const successfulSupervisors = [];

    for (const element of data) {
      const {
        supervisorName,
        email,
        password,
        phone_no,
        address,
        deviceName,
        deviceId,
        schoolName,
        branchName,
      } = element;

      if (!schoolName || !branchName) {
        errors.push(`School name and branch name are required for ${email}`);
        continue; // Skip to the next iteration
      }

      const existingSupervisor = await Supervisor.findOne({ email });
      if (existingSupervisor) {
        errors.push(`Supervisor email already exists for ${email}`);
        continue; 
      }

      const school = await School.findOne({
        schoolName: new RegExp(`^${schoolName.trim()}$`, "i"),
      }).populate("branches");
      if (!school) {
        errors.push(`School not found for ${email}`);
        continue;
      }

      const branch = school.branches.find(
        (branch) =>
          branch.branchName.toLowerCase() === branchName.trim().toLowerCase()
      );
      if (!branch) {
        errors.push(`Branch not found in the specified school for ${email}`);
        continue;
      }

      const newSupervisor = new Supervisor({
        supervisorName,
        email,
        password, 
        phone_no,
        address,
        deviceName,
        deviceId,
        schoolId: school._id,
        branchId: branch._id,
        statusOfRegister: "pending",
      });

      try {
        const response = await newSupervisor.save();
        const payload = {
          id: response._id,
          email: response.email,
          schoolId: school._id,
          branchId: branch._id,
        };
        const token = generateToken(payload);
        
        // Collect successful registrations
        successfulSupervisors.push({
          supervisor: { ...response.toObject(), password: undefined }, // Exclude password
          token,
        });
      } catch (err) {
        errors.push(`Failed to save supervisor ${email}: ${err.message}`);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ errors, successfulSupervisors });
    }

    return res.status(201).json({ successfulSupervisors });

  } catch (error) {
    console.error("Error during supervisor registration:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};