const express = require("express");
const router = express.Router();
const School = require("../models/school");
const Child = require("../models/child");
const Request = require("../models/request");
const Parent = require("../models/Parent");
const Supervisor = require("../models/supervisor");
const Attendance = require("../models/attendence");
const { schoolAuthMiddleware,generateToken } = require("../jwt");
const { decrypt } = require('../models/cryptoUtils');
const DriverCollection = require('../models/driver');
const { formatDateToDDMMYYYY } = require('../utils/dateUtils');
const jwt = require("jsonwebtoken");
const Branch = require('../models/branch');
const Geofencing = require("../models/geofence");
const Device = require('../models/device');

const convertDate = (dateStr) => {
  const dateParts = dateStr.split('-');
  const jsDate = new Date(`${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`);
  return {
    date: dateStr,
    originalDate: jsDate
  };
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    // Find the school by username
    const school = await School.findOne({ username });
    if (!school) {
      return res.status(400).json({ error: 'Invalid username or password' });
    }

    // Compare the provided password with the stored hashed password
    const isMatch = await school.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid username or password' });
    }

    // Generate the token using the existing function
    const token = generateToken({
      id: school._id,
      username: school.username,
      role: 'school',
      schoolName : school.schoolName,
      branchName : school.mainBranch,
      branches: school.branches
    });

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      role: 'schooladmin'
    });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Server error' });
  }
});
router.post('/add-branch', schoolAuthMiddleware, async (req, res) => {
  try {
    const { schoolId, branchName, email, schoolMobile, username, password } = req.body;

    // Validate school existence
    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(400).json({ error: 'School not found' });
    }

    // Check if the username is already taken
    const existingBranch = await Branch.findOne({ username });
    if (existingBranch) {
      return res.status(400).json({ error: 'Username already exists. Please choose a different one.' });
    }

    // Create a new branch
    const newBranch = new Branch({
      branchName,
      schoolId,
      email,
      schoolMobile,
      username,
      password
    });

    const savedBranch = await newBranch.save();

    // Link the branch to the school
    await School.findByIdAndUpdate(schoolId, {
      $push: { branches: { _id: savedBranch._id, branchName: savedBranch.branchName } }
    });

    res.status(201).json({ branch: savedBranch });
  } catch (error) {
    console.error('Error adding branch:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// GET METHOD 
router.get('/branches', schoolAuthMiddleware, async (req, res) => {
  try {
    const { schoolId } = req; // Extract schoolId from the request token

    // Fetch the school details including the password
    const school = await School.findById(schoolId);
    if (!school) {
      return res.status(400).json({ error: 'School not found' });
    }

    // Decrypt school password if it exists
    let schoolData = school.toObject();
    if (schoolData.password) {
      schoolData.password = decrypt(schoolData.password); // Decrypt the school's password
    }

    // Fetch branches for the specified school
    let branches = await Branch.find({ schoolId })
      .populate({
        path: 'devices',
        select: 'deviceId deviceName' // Select specific fields from devices
      });

    // Map branches to include school's username, password, and other details if missing
    branches = branches.map(branch => {
      const branchData = branch.toObject(); // Convert mongoose document to plain object

      // Attempt to decrypt branch password, if it exists
      let branchPassword = branchData.password;
      if (branchPassword && branchPassword.trim() !== "") {
        try {
          branchPassword = decrypt(branchPassword); // Decrypt the branch password
        } catch (error) {
          console.error(`Error decrypting branch password for branch ${branchData._id}:`, error);
        }
      }

      return {
        ...branchData, // Spread branch data
        username: branchData.username || schoolData.username, // Inherit school's username if missing
        password: branchPassword || schoolData.password, // Use decrypted branch password or school's password if branch password is missing or empty
        email: branchData.email || schoolData.email, // Inherit school's email if missing
        schoolMobile: branchData.schoolMobile || schoolData.schoolMobile, // Inherit school's mobile if missing
      };
    });

    // Structure the response
    res.status(200).json({
      school: {
        ...schoolData, // Include decrypted school password
        branches // Include updated branches with the correct password mapping
      }
    });

  } catch (error) {
    console.error('Error fetching branches:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.get('/read-devices', schoolAuthMiddleware, async (req, res) => {
  const { schoolId } = req; // Assuming schoolId comes from authentication middleware

  try {
    // Fetch all branches associated with the current school
    const branches = await Branch.find({ schoolId }).lean();

    // Create a map to group devices by branches
    const branchesMap = {};

    // Loop through each branch to get devices
    for (const branch of branches) {
      const branchId = branch._id;

      // Fetch all devices for the current branch
      const devices = await Device.find({ schoolId: schoolId, branchId: branchId }).lean();

      // Map over devices and return the relevant details
      const formattedDevices = devices.map((device) => ({
        deviceId: device.deviceId, // Manually added deviceId
        actualDeviceId: device._id, // MongoDB generated _id as actualDeviceId
        deviceName: device.deviceName,
      }));

      // Add the branch and its devices to the branchesMap
      branchesMap[branchId] = {
        branchId: branchId,
        branchName: branch.branchName,
        devices: formattedDevices,
      };
    }

    // Convert branchesMap object into an array of branches
    const branchesArray = Object.values(branchesMap);

    // Prepare the final response data
    const responseData = {
      schoolId: schoolId,
      schoolName: branches.length > 0 ? branches[0].schoolId.schoolName : 'N/A',
      branches: branchesArray,
    };

    // Send the formatted devices grouped by branches as a JSON response
    res.status(200).json(responseData);
  } catch (error) {
    console.error('Error fetching devices by school:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.get('/read-children', schoolAuthMiddleware, async (req, res) => {
  try {
    const { schoolId } = req; // Extract schoolId from token

    // Fetch the school along with its branches based on schoolId
    const school = await School.findById(schoolId)
      .populate({
        path: 'branches',
        select: 'branchName',
      })
      .lean();

    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }

    const result = {
      schoolId: school._id,
      schoolName: school.schoolName,
      branches: [],
    };

    const branchPromises = school.branches.map(async (branch) => {
      const children = await Child.find({ branchId: branch._id })
        .populate({
          path: 'parentId',
          select: 'parentName email phone password',
        })
        .lean();

      const formattedChildren = await Promise.all(children.map(async (child) => {
        // Decrypt the parent's password
        const parent = await Parent.findById(child.parentId._id).lean();
        const password = parent ? decrypt(parent.password) : '';

        return {
          schoolName: school.schoolName, // Add schoolName
          branchName: branch.branchName,  // Add branchName
          childId: child._id,
          childName: child.childName,
          class: child.class,
          rollno: child.rollno,
          section: child.section,
          dateOfBirth: child.dateOfBirth,
          childAge: child.childAge,
          pickupPoint: child.pickupPoint,
          deviceName: child.deviceName,
          gender: child.gender,
          parentId: child.parentId._id,
          parentName: child.parentId.parentName,
          email: child.parentId.email,
          phone: child.parentId.phone,
          password, // Include decrypted password here
          statusOfRegister: child.statusOfRegister,
          deviceId: child.deviceId,
          registrationDate: child.registrationDate,
          formattedRegistrationDate: formatDateToDDMMYYYY(new Date(child.registrationDate)),
        };
      }));

      result.branches.push({
        branchId: branch._id,
        branchName: branch.branchName,
        children: formattedChildren,
      });
    });

    await Promise.all(branchPromises);

    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching school data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.get('/read-parents', schoolAuthMiddleware, async (req, res) => {
  try {
    const { schoolId } = req; // Extract schoolId from the request token

    // Fetch the school to include the school name
    const school = await School.findById(schoolId).lean();

    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }

    // Fetch all parents for the specific school and populate branch and child details
    const parents = await Parent.find({ schoolId })
      .populate({
        path: 'branchId', // Populate branch details
        select: 'branchName',
      })
      .populate({
        path: 'children', // Populate child details
        select: 'childName' // Adjust as needed
      })
      .lean();

    // Transform and group parents by branch
    const branchesMap = {};

    parents.forEach(parent => {
      if (parent.branchId) {
        const branchId = parent.branchId._id.toString();

        if (!branchesMap[branchId]) {
          branchesMap[branchId] = {
            branchId: branchId,
            branchName: parent.branchId.branchName,
            parents: []
          };
        }

        branchesMap[branchId].parents.push({
          parentId: parent._id,
          parentName: parent.parentName,
          email: parent.email,
          phone: parent.phone,
          address: parent.address,
          password: decrypt(parent.password), // Decrypt the password
          registrationDate: formatDateToDDMMYYYY(new Date(parent.parentRegistrationDate)),
          statusOfRegister: parent.statusOfRegister, // Add statusOfRegister field
          schoolId: school._id, // Add schoolId to parent data
          schoolName: school.schoolName, // Add schoolName to parent data
          children: parent.children.map(child => ({
            childId: child._id,
            childName: child.childName
          })) // Add child details to parent data
        });
      }
    });

    // Convert branchesMap to an array
    const branches = Object.values(branchesMap);

    res.status(200).json({
      schoolId: school._id,
      schoolName: school.schoolName,
      branches,
    });
  } catch (error) {
    console.error('Error fetching parents:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.get("/pending-requests", schoolAuthMiddleware, async (req, res) => {
  try {
    const { schoolId } = req;

    // Fetch the school to include the school name
    const school = await School.findById(schoolId).lean();
    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }

    // Fetch all pending requests for the specific school
    const requests = await Request.find({
      statusOfRequest: "pending",
      schoolId,
    })
      .populate({
        path: "childId",
        populate: {
          path: "schoolId branchId",
          select: "schoolName branchName", // Only include the names
        },
        select: "childName class schoolId branchId deviceId deviceName", // Ensure we get the schoolId and branchId
      })
      .populate("parentId", "parentName email phone password parentRegistrationDate")
      .lean();

    // Filter out requests where the parent or child does not exist
    const validRequests = requests.filter(
      (request) => request.parentId && request.childId
    );

    // Group requests by branch
    const branchesMap = {};

    validRequests.forEach(request => {
      const branchId = request.childId.branchId?._id.toString();
      const branchName = request.childId.branchId?.branchName || "Unknown Branch";
      const schoolName = school.schoolName; 

      const formattedRequest = {
        requestId: request._id,
        reason: request.reason,
        class: request.childId.class,
        statusOfRequest: request.statusOfRequest,
        parentId: request.parentId._id,
        parentName: request.parentId.parentName,
        phone: request.parentId.phone,
        email: request.parentId.email,
        childId: request.childId._id,
        childName: request.childId.childName,
        requestType: request.requestType,
        deviceName: request.childId.deviceName,
        deviceId:request.childId.deviceId,
        deviceName:request.childId.deviceName,
        requestDate: request.requestDate,
        requestDate: request.requestDate
          ? formatDateToDDMMYYYY(new Date(request.requestDate))
          : null,
          branchName: branchName,
       schoolName : schoolName
      };

      // Add fields conditionally based on the request type
      if (request.requestType === "leave") {
        formattedRequest.startDate = request.startDate
          ? formatDateToDDMMYYYY(new Date(request.startDate))
          : null;
        formattedRequest.endDate = request.endDate
          ? formatDateToDDMMYYYY(new Date(request.endDate))
          : null;
        formattedRequest.newRoute = null;
      } else if (request.requestType === "changeRoute") {
        formattedRequest.newRoute = request.newRoute || null;
        formattedRequest.startDate = null;
        formattedRequest.endDate = null;
      } else {
        formattedRequest.startDate = null;
        formattedRequest.endDate = null;
        formattedRequest.newRoute = null;
      }

      // If the branch does not exist in the map, add it
      if (!branchesMap[branchId]) {
        branchesMap[branchId] = {
          branchId,
          branchName,
          requests: [],
        };
      }

      // Add the request to the respective branch
      branchesMap[branchId].requests.push(formattedRequest);
    });

    // Convert the branchesMap object into an array of branches
    const branches = Object.values(branchesMap);

    // Prepare the final response data
    const responseData = {
      schoolId: school._id,
      schoolName: school.schoolName,
      branches,
    };

    // Send the formatted requests as a JSON response
    res.status(200).json(responseData);
  } catch (error) {
    console.error("Error fetching requests:", error);
    res.status(500).json({
      error: "Internal server error",
    });
  }
});
router.get("/approved-requests", schoolAuthMiddleware, async (req, res) => {
  try {
    const { schoolId } = req;

    // Fetch the school details
    const school = await School.findById(schoolId).lean();
    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }

    const schoolName = school.schoolName;

    // Fetch all approved requests for the specific school
    const requests = await Request.find({ statusOfRequest: "approved", schoolId })
      .populate("parentId", "parentName email phone password parentRegistrationDate")
      .populate({
        path: "childId",
        populate: {
          path: "branchId",
          select: "branchName", // Populate branchName
        },
        select: "childName class branchId deviceId deviceName",
      })
      .lean();

    // Filter out requests where the parent or child does not exist
    const validRequests = requests.filter(request => request.parentId && request.childId);

    // Group requests by branch
    const branchesMap = {};

    // Format requests and organize them by branch
    validRequests.forEach((request) => {
      const branchId = request.childId.branchId._id;
      const branchName = request.childId.branchId.branchName;

      const formattedRequest = {
        requestId: request._id,
        reason: request.reason,
        class: request.childId.class,
        statusOfRequest: request.statusOfRequest,
        parentId: request.parentId._id,
        parentName: request.parentId.parentName,
        phone: request.parentId.phone,
        email: request.parentId.email,
        childId: request.childId._id,
        childName: request.childId.childName,
        requestType: request.requestType,
        deviceId:request.childId.deviceId,
        deviceName:request.childId.deviceName,
        schoolName: schoolName,
        branchName: branchName,
        requestDate : request.requestDate ? formatDateToDDMMYYYY(new Date(request.requestDate)) : null,
        startDate: null,
        endDate: null,
        newRoute: null
      };

      // Add fields conditionally based on the request type
      if (request.requestType === 'leave') {
        formattedRequest.startDate = request.startDate
        ? formatDateToDDMMYYYY(new Date(request.startDate))
        : null;
        formattedRequest.endDate = request.endDate
        ? formatDateToDDMMYYYY(new Date(request.endDate))
        : null;
      } else if (request.requestType === 'changeRoute') {
        formattedRequest.newRoute = request.newRoute || null;
      }

      // If the branch does not exist in the map, add it
      if (!branchesMap[branchId]) {
        branchesMap[branchId] = {
          branchId: branchId,
          branchName: branchName,
          requests: [],
        };
      }

      // Add the request to the respective branch
      branchesMap[branchId].requests.push(formattedRequest);
    });

    // Convert the branchesMap object into an array of branches
    const branches = Object.values(branchesMap);

    // Prepare the final response data
    const responseData = {
      schoolId: school._id,
      schoolName: school.schoolName,
      branches,
    };

    // Send the formatted requests as a JSON response
    res.status(200).json(responseData);
  } catch (error) {
    console.error("Error fetching requests:", error);
    res.status(500).json({
      error: "Internal server error",
    });
  }
});
router.get('/denied-requests', schoolAuthMiddleware, async (req, res) => {
  try {
    const { schoolId } = req;

    // Fetch the school details
    const school = await School.findById(schoolId).lean();
    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }

    const schoolName = school.schoolName;

    // Fetch all denied requests for the specific school
    const deniedRequests = await Request.find({ statusOfRequest: 'denied', schoolId })
      .populate("parentId", "parentName email phone")
      .populate({
        path: 'childId',
        populate: {
          path: 'branchId',
          select: 'branchName', // Populate branchName
        },
        select: 'childName deviceId class branchId deviceName',
      })
      .lean();

    // Filter out requests where parentId or childId is null or not populated
    const validRequests = deniedRequests.filter(request => request.parentId && request.childId);

    // Group requests by branch
    const branchesMap = {};

    // Format requests and organize them by branch
    validRequests.forEach((request) => {
      const branchId = request.childId.branchId._id;
      const branchName = request.childId.branchId.branchName;

      const formattedRequest = {
        requestId: request._id, // Assuming you want to keep track of the requestId
        statusOfRequest: request.statusOfRequest,
        parentId: request.parentId._id,
        parentName: request.parentId.parentName,
        phone: request.parentId.phone,
        email: request.parentId.email,
        childId: request.childId._id,
        childName: request.childId.childName,
        class: request.childId.class,
        deviceId: request.childId.deviceId,
        deviceName: request.childId.deviceName,
        schoolName: schoolName,
        branchName: branchName,
        requestType:request.requestType,
        requestDate: request.requestDate ? formatDateToDDMMYYYY(new Date(request.requestDate)) : null,
        startDate: null,
        endDate: null,
        newRoute: null
      };
    // Add fields conditionally based on the request type
    if (request.requestType === 'leave') {
      formattedRequest.startDate = request.startDate
      ? formatDateToDDMMYYYY(new Date(request.startDate))
      : null;
      formattedRequest.endDate = request.endDate
      ? formatDateToDDMMYYYY(new Date(request.endDate))
      : null;
    } else if (request.requestType === 'changeRoute') {
      formattedRequest.newRoute = request.newRoute || null;
    }




      // If the branch does not exist in the map, add it
      if (!branchesMap[branchId]) {
        branchesMap[branchId] = {
          branchId: branchId,
          branchName: branchName,
          requests: [],
        };
      }

      // Add the request to the respective branch
      branchesMap[branchId].requests.push(formattedRequest);
    });

    // Convert the branchesMap object into an array of branches
    const branches = Object.values(branchesMap);

    // Prepare the final response data
    const responseData = {
      schoolId: school._id,
      schoolName: school.schoolName,
      branches,
    };

    // Send the formatted requests as a JSON response
    res.status(200).json(responseData);
  } catch (error) {
    console.error('Error fetching denied requests:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.get('/read-drivers', schoolAuthMiddleware, async (req, res) => {
  const { schoolId } = req;

  try {
    // Fetch drivers associated with the specific school and populate the school and branch names
    const drivers = await DriverCollection.find({ schoolId })
      .populate('schoolId', 'schoolName') // Populate schoolName from the School collection
      .populate('branchId', 'branchName') // Populate branchName from the Branch collection
      .lean(); // Use .lean() to get plain JavaScript objects

    // Group drivers by branch
    const branchesMap = {};

    // Format driver data and group by branch
    const driverData = drivers.map(driver => {
      try {
        console.log(`Decrypting password for driver: ${driver.driverName}, encryptedPassword: ${driver.password}`);
        const decryptedPassword = decrypt(driver.password);

        const formattedDriver = {
          id: driver._id,
          driverName: driver.driverName,
          address: driver.address,
          driverMobile: driver.driverMobile,
          email: driver.email,
          deviceName:driver.deviceName,
          deviceId: driver.deviceId,
          password: decryptedPassword,
          statusOfRegister:driver.statusOfRegister,
          registrationDate: driver.registrationDate,
          formattedRegistrationDate: driver.registrationDate ? formatDateToDDMMYYYY(new Date(driver.registrationDate)) : null,
          schoolName: driver.schoolId ? driver.schoolId.schoolName : 'N/A', // Include the school name
          branchName: driver.branchId ? driver.branchId.branchName : 'N/A' // Include the branch name
        };

        // If the branch does not exist in the map, add it
        if (!branchesMap[driver.branchId._id]) {
          branchesMap[driver.branchId._id] = {
            branchId: driver.branchId._id,
            branchName: driver.branchId.branchName,
            drivers: []
          };
        }

        // Add the driver to the respective branch
        branchesMap[driver.branchId._id].drivers.push(formattedDriver);

        return null; // We're using branchesMap to collect driver data
      } catch (decryptError) {
        console.error(`Error decrypting password for driver: ${driver.driverName}`, decryptError);
        return null;
      }
    }).filter(driver => driver !== null);

    // Convert the branchesMap object into an array of branches
    const branches = Object.values(branchesMap);

    // Prepare the final response data
    const responseData = {
      schoolId: schoolId,
      schoolName: drivers.length > 0 ? drivers[0].schoolId.schoolName : 'N/A',
      branches
    };

    // Send the formatted drivers as a JSON response
    res.status(200).json(responseData);
  } catch (error) {
    console.error('Error fetching drivers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.get('/read-supervisors', schoolAuthMiddleware, async (req, res) => {
  const { schoolId } = req;

  try {
    // Fetch supervisors associated with the specific school and populate both school name and branch name
    const supervisors = await Supervisor.find({ schoolId })
      .populate('schoolId', 'schoolName') // Populate the schoolId field with schoolName
      .populate('branchId', 'branchName') // Populate the branchId field with branchName
      .lean();

    // Group supervisors by branch
    const branchesMap = {};

    // Format supervisor data and group by branch
    const supervisorData = supervisors.map(supervisor => {
      try {
        console.log(`Decrypting password for supervisor: ${supervisor.supervisorName}, encryptedPassword: ${supervisor.password}`);
        const decryptedPassword = decrypt(supervisor.password);
        
        const formattedSupervisor = {
          id : supervisor._id,
          supervisorName: supervisor.supervisorName,
          address: supervisor.address,
          phone_no: supervisor.phone_no,
          email: supervisor.email,
          deviceId: supervisor.deviceId,
          deviceName:supervisor.deviceName,
          password: decryptedPassword,
          statusOfRegister:supervisor.statusOfRegister,
          registrationDate: supervisor.registrationDate,
          formattedRegistrationDate: supervisor.registrationDate ? formatDateToDDMMYYYY(new Date(supervisor.registrationDate)) : null,
          schoolName: supervisor.schoolId ? supervisor.schoolId.schoolName : 'N/A', // Include school name
          branchName: supervisor.branchId ? supervisor.branchId.branchName : 'Branch not found', // Include branch name
        };

        // If the branch does not exist in the map, add it
        if (!branchesMap[supervisor.branchId._id]) {
          branchesMap[supervisor.branchId._id] = {
            branchId: supervisor.branchId._id,
            branchName: supervisor.branchId.branchName,
            supervisors: []
          };
        }

        // Add the supervisor to the respective branch
        branchesMap[supervisor.branchId._id].supervisors.push(formattedSupervisor);

        return null; // We're using branchesMap to collect supervisor data
      } catch (decryptError) {
        console.error(`Error decrypting password for supervisor: ${supervisor.supervisorName}`, decryptError);
        return null;
      }
    }).filter(supervisor => supervisor !== null);

    // Convert the branchesMap object into an array of branches
    const branches = Object.values(branchesMap);

    // Prepare the final response data
    const responseData = {
      schoolId: schoolId,
      schoolName: supervisors.length > 0 ? supervisors[0].schoolId.schoolName : 'N/A',
      branches
    };

    // Send the formatted supervisors as a JSON response
    res.status(200).json(responseData);
  } catch (error) {
    console.error('Error fetching supervisors:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.get('/geofences', schoolAuthMiddleware, async (req, res) => {
  const { schoolId } = req; // Extract schoolId from the authenticated request

  try {
    // Fetch the school name based on schoolId
    const school = await School.findById(schoolId).select('schoolName');
    if (!school) {
      return res.status(404).json({ message: 'School not found' });
    }

    // Fetch branches associated with the logged-in school
    const branches = await Branch.find({ schoolId }).select('_id branchName'); // Get branch IDs and branch names

    // Get deviceIds and deviceNames for the branches
    const devices = await Device.find({ branchId: { $in: branches.map(branch => branch._id) } })
      .select('deviceId branchId deviceName'); // Fetch deviceId, branchId, and deviceName

    // Extract deviceIds to search geofences
    const deviceIds = devices.map(device => device.deviceId);

    // Fetch geofences for the retrieved deviceIds
    const geofences = await Geofencing.find({ deviceId: { $in: deviceIds } });

    // Group geofences by branch based on device
    const branchesMap = {};
    geofences.forEach(geofence => {
      // Find the device for the current geofence
      const device = devices.find(device => device.deviceId.toString() === geofence.deviceId.toString());

      if (device) {
        // Find the branch associated with the device
        const branch = branches.find(branch => branch._id.toString() === device.branchId.toString());

        if (!branch) return; // If no branch is found, skip this geofence

        // Initialize the branch in the map if not already present
        if (!branchesMap[branch._id]) {
          branchesMap[branch._id] = {
            branchId: branch._id,
            branchName: branch.branchName,
            geofences: []
          };
        }

        // Add geofence to the respective branch, including school and branch names, and deviceName
        branchesMap[branch._id].geofences.push({
          _id: geofence._id,
          name: geofence.name,
          area: geofence.area,
          busStopTime: geofence.busStopTime,
          isCrossed: geofence.isCrossed,
          deviceId: geofence.deviceId,
          deviceName: device.deviceName, // Add deviceName to the response
          schoolName: school.schoolName, // Include schoolName
          branchName: branch.branchName, // Include branchName
          __v: geofence.__v
        });
      }
    });

    // Convert the branchesMap object into an array of branches with geofences
    const responseBranches = Object.values(branchesMap);

    // Respond with the grouped geofences by branches, including the schoolId
    res.status(200).json({
      schoolId: schoolId,
      branches: responseBranches
    });
  } catch (error) {
    console.error('Error fetching geofences:', error);
    res.status(500).json({ message: 'Error retrieving geofences', error });
  }
});
router.get("/pickup-drop-status", schoolAuthMiddleware, async (req, res) => {
  try {
    // Extract the schoolId from the request (set by the schoolAuthMiddleware)
    const schoolId = req.schoolId;

    // Fetch attendance records only for the children associated with this schoolId
    const attendanceRecords = await Attendance.find({})
      .populate({
        path: "childId",
        match: { schoolId }, // Filter children by schoolId
        populate: [
          { path: "parentId", select: "phone" }, // Populate parentId to get the parent's phone
          { path: "branchId", select: "branchName" }, // Populate branchId to get the branch name
          { path: "schoolId", select: "schoolName" } // Populate schoolId to get the school name
        ]
      })
      .lean();

    // Group children by branch
    const branchesMap = {};

    // Format and group children data
    attendanceRecords
      .filter(record => record.childId && record.childId.parentId)
      .forEach(record => {
        const { date, originalDate } = convertDate(record.date);
        const childData = {
          _id: record.childId._id,
          childName: record.childId.childName,
          class: record.childId.class,
          rollno: record.childId.rollno,
          section: record.childId.section,
          parentId: record.childId.parentId._id,
          phone: record.childId.parentId.phone,
          branchName: record.childId.branchId ? record.childId.branchId.branchName : "Branch not found",
          schoolName: record.childId.schoolId ? record.childId.schoolId.schoolName : "School not found",
          pickupStatus: record.pickup,
          pickupTime: record.pickupTime,
          deviceId: record.childId.deviceId,
          pickupPoint: record.childId.pickupPoint,
          dropStatus: record.drop,
          dropTime: record.dropTime,
          deviceName: record.childId.deviceName,
          deviceId: record.childId.deviceId,
          date:record.date
        };

        // If the branch doesn't exist in the map, add it
        if (!branchesMap[record.childId.branchId._id]) {
          branchesMap[record.childId.branchId._id] = {
            branchId: record.childId.branchId._id,
            branchName: record.childId.branchId.branchName,
            children: []
          };
        }

        // Add the child data to the respective branch
        branchesMap[record.childId.branchId._id].children.push(childData);
      });

    // Convert branchesMap into an array of branches
    const branches = Object.values(branchesMap);

    // Prepare the final response
    const responseData = {
      schoolId: schoolId,
      schoolName: schoolId.schoolName,
      branches
    };

    // Send the response
    res.status(200).json(responseData);
  } catch (error) {
    console.error("Error fetching attendance data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
router.get("/present-children", schoolAuthMiddleware, async (req, res) => {
  try {
    const schoolId = req.schoolId;

    const attendanceRecords = await Attendance.find({ pickup: true })
      .populate({
        path: "childId",
        match: { schoolId },
        populate: [
          { path: "parentId", select: "phone" },
          { path: "branchId", select: "branchName" },
          { path: "schoolId", select: "schoolName" }
        ]
      })
      .lean();

    const branchMap = {};

    attendanceRecords.forEach(record => {
      // Ensure childId and branchId are not null or undefined
      if (record.childId && record.childId.branchId) {
        const branchId = record.childId.branchId._id || 'unknown';

        if (!branchMap[branchId]) {
          branchMap[branchId] = {
            branchId: branchId,
            branchName: record.childId.branchId.branchName || "Branch not found",
            children: []
          };
        }

        const childData = {
          _id: record.childId._id,
          childName: record.childId.childName,
          class: record.childId.class,
          rollno: record.childId.rollno,
          section: record.childId.section,
          parentId: record.childId.parentId ? record.childId.parentId._id : null,
          phone: record.childId.parentId ? record.childId.parentId.phone : null,
          branchName: record.childId.branchId.branchName || "Branch not found",
          schoolName: record.childId.schoolId ? record.childId.schoolId.schoolName : "School not found",
          pickupStatus: record.pickup,
          pickupTime: record.pickupTime,
          deviceId: record.childId.deviceId,
          pickupPoint: record.childId.pickupPoint,
          deviceName: record.childId.deviceName,
          date: record.date
        };

        branchMap[branchId].children.push(childData);
      }
    });

    const branches = Object.values(branchMap);
    const school = await School.findById(schoolId).lean();

    const responseData = {
      schoolId: schoolId,
      schoolName: school ? school.schoolName : "School not found",
      branches: branches
    };

    res.status(200).json(responseData);
  } catch (error) {
    console.error("Error fetching present pickup data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
router.get("/absent-children", schoolAuthMiddleware, async (req, res) => {
  try {
    const schoolId = req.schoolId;

    const attendanceRecords = await Attendance.find({ pickup: false })
      .populate({
        path: "childId",
        match: { schoolId },
        populate: [
          { path: "parentId", select: "phone" },
          { path: "branchId", select: "branchName" },
          { path: "schoolId", select: "schoolName" }
        ]
      })
      .lean();

    const branchMap = {};

    attendanceRecords.forEach(record => {
      // Ensure childId and branchId are not null or undefined
      if (record.childId && record.childId.branchId) {
        const branchId = record.childId.branchId._id || 'unknown';

        if (!branchMap[branchId]) {
          branchMap[branchId] = {
            branchId: branchId,
            branchName: record.childId.branchId.branchName || "Branch not found",
            children: []
          };
        }

        const childData = {
          _id: record.childId._id,
          childName: record.childId.childName,
          class: record.childId.class,
          rollno: record.childId.rollno,
          section: record.childId.section,
          parentId: record.childId.parentId ? record.childId.parentId._id : null,
          phone: record.childId.parentId ? record.childId.parentId.phone : null,
          branchName: record.childId.branchId.branchName || "Branch not found",
          schoolName: record.childId.schoolId ? record.childId.schoolId.schoolName : "School not found",
          pickupStatus: record.pickup,
          pickupTime: record.pickupTime,
          deviceId: record.childId.deviceId,
          deviceName: record.childId.deviceName,
          pickupPoint: record.childId.pickupPoint,
          date: record.date
        };

        branchMap[branchId].children.push(childData);
      }
    });

    const branches = Object.values(branchMap);
    const school = await School.findById(schoolId).lean();

    const responseData = {
      schoolId: schoolId,
      schoolName: school ? school.schoolName : "School not found",
      branches: branches
    };

    res.status(200).json(responseData);
  } catch (error) {
    console.error("Error fetching absent children data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
router.get('/status/:childId', schoolAuthMiddleware, async (req, res) => {
  try {
    const { childId } = req.params;
    const schoolId = req.schoolId;

    // Find the child within the specified school and populate branch and parent details
    const child = await Child.findOne({ _id: childId, schoolId })
      .populate({
        path: 'parentId',
        select: 'parentName phone password email'
      })
      .populate({
        path: 'branchId', // Populate branchId field
        select: 'branchName'
      })
      .populate({
        path: 'schoolId', // Populate schoolId field
        select: 'schoolName'
      })
      .lean(); // Convert to plain JavaScript object

    if (!child) {
      return res.status(404).json({ message: 'Child not found' });
    }

    const parent = child.parentId;
    const password = parent ? decrypt(parent.password) : 'Unknown Password';
    // Fetch the most recent attendance record for the child
    const attendance = await Attendance.findOne({ childId })
      .sort({ date: -1 })
      .limit(1);

    // Fetch the most recent request for the child
    const request = await Request.findOne({ childId })
      .sort({ requestDate: -1 })
      .limit(1);

    // Fetch the supervisor based on deviceId and schoolId
    let supervisor = null;
    if (child.deviceId) {
      supervisor = await Supervisor.findOne({ deviceId: child.deviceId, schoolId });
    }

    // Construct the response object only with fields that have data
    const response = {};

    if (child.childName) response.childName = child.childName;
    if (child.class) response.childClass = child.class;
    if (child.rollno) response.rollno = child.rollno;
    if (child.deviceId) response.deviceId = child.deviceId;
    if (child.deviceName) response.deviceName = child.deviceName;
    if (child.gender) response.gender = child.gender;
    if (child.pickupPoint) response.pickupPoint = child.pickupPoint;
    if (password) response.password = password; 
    if (parent && parent.parentName) response.parentName = parent.parentName;
    if (parent && parent.phone) response.parentNumber = parent.phone;
    if (child.branchId && child.branchId.branchName) response.branchName = child.branchId.branchName;
    if (child.schoolId && child.schoolId.schoolName) response.schoolName = child.schoolId.schoolName;
    if (attendance && attendance.pickup !== undefined) response.pickupStatus = attendance.pickup ? 'Present' : 'Absent';
    if (attendance && attendance.drop !== undefined) response.dropStatus = attendance.drop ? 'Present' : 'Absent';
    if (attendance && attendance.pickupTime) response.pickupTime = attendance.pickupTime;
    if (attendance && attendance.dropTime) response.dropTime = attendance.dropTime;
    if (attendance && attendance.date) response.date = attendance.date;
    if (request && request.requestType) response.requestType = request.requestType;

    // Format startDate, endDate, and requestDate to 'dd-mm-yyyy'
    if (request && request.startDate) response.startDate = formatDateToDDMMYYYY(request.startDate);
    if (request && request.endDate) response.endDate = formatDateToDDMMYYYY(request.endDate);
    if (request && request.requestDate) response.requestDate = formatDateToDDMMYYYY(request.requestDate);

    if (request && request.reason) response.reason = request.reason;
    if (request && request.newRoute) response.newRoute = request.newRoute;
    if (request && request.statusOfRequest) response.statusOfRequest = request.statusOfRequest;
    if (supervisor && supervisor.supervisorName) response.supervisorName = supervisor.supervisorName;

    // Send the filtered response
    res.json({child:response});
  } catch (error) {
    console.error('Error fetching child status:', error);
    res.status(500).json({ message: 'Server error' });
  }
});
router.get('/status-of-children', schoolAuthMiddleware, async (req, res) => {
  try {
    const schoolId = req.schoolId;

    // Fetch all children associated with the school and populate branch, parent, and school details
    const children = await Child.find({ schoolId })
      .populate({
        path: 'parentId',
        select: 'parentName phone email password'
      })
      .populate({
        path: 'branchId',
        select: 'branchName'
      })
      .populate({
        path: 'schoolId',
        select: 'schoolName'
      })
      .lean(); // Convert to plain JavaScript object

    if (children.length === 0) {
      return res.status(404).json({ message: 'No children found for this school' });
    }

    // Group children by branch
    const branchesMap = {};

    // Loop over each child to fetch related data (attendance, request, supervisor)
    for (const child of children) {
      const parent = child.parentId;

      // Fetch the most recent attendance record for each child
      const attendance = await Attendance.findOne({ childId: child._id })
        .sort({ date: -1 })
        .lean();

      // Fetch the most recent request for each child
      const request = await Request.findOne({ childId: child._id })
        .sort({ requestDate: -1 })
        .lean();

      // Fetch the supervisor based on deviceId and schoolId
      let supervisor = null;
      if (child.deviceId) {
        supervisor = await Supervisor.findOne({ deviceId: child.deviceId, schoolId }).lean();
      }
      const password = parent ? decrypt(parent.password) : 'Unknown Password';
      // Check if the child has any relevant data
      if (attendance || request) {
        // Prepare the child status data
        const childData = {
          childId: child._id,
          childName: child.childName,
          childClass: child.class,
          childAge:child.childAge,
          section:child.section,
          childAge: child.childAge,
          rollno: child.rollno,
          deviceId: child.deviceId,
          deviceName:child.deviceName,
          gender: child.gender,
          pickupPoint: child.pickupPoint,
            parentName: parent ? parent.parentName : 'Parent not found',
            parentNumber: parent ? parent.phone : 'Parent not found',
            email:parent ? parent.email :"unknown email",
            password: password,
          ...(attendance && {
            pickupStatus: attendance.pickup ? 'Present' : 'Absent',
            dropStatus: attendance.drop ? 'Present' : 'Absent',
            pickupTime: attendance.pickupTime,
            dropTime: attendance.dropTime,
            date: attendance.date
          }),
          ...(request && {
              requestType: request.requestType,
              startDate: formatDateToDDMMYYYY(request.startDate)|| 'N/A',
              endDate: formatDateToDDMMYYYY(request.endDate) || 'N/A',
              reason: request.reason || 'N/A',
              newRoute: request.newRoute || 'N/A',
              statusOfRequest: request.statusOfRequest || 'N/A',
              requestDate: formatDateToDDMMYYYY(request.requestDate) || 'N/A'            
          }),
          ...(supervisor && {
            supervisorName: supervisor.supervisorName
          })
        };

        // Group children by branch
        if (!branchesMap[child.branchId._id]) {
          branchesMap[child.branchId._id] = {
            branchId: child.branchId._id,
            branchName: child.branchId.branchName,
            children: []
          };
        }

        // Add the child to the respective branch
        branchesMap[child.branchId._id].children.push(childData);
      }
    }

    // Convert the branchesMap into an array of branches
    const branches = Object.values(branchesMap);

    // Prepare the final response object
    const response = {
      schoolId: schoolId,
      schoolName: children[0].schoolId ? children[0].schoolId.schoolName : 'N/A',
      branches
    };

    // Send the response
    res.json(response);
  } catch (error) {
    console.error('Error fetching all children status:', error);
    res.status(500).json({ message: 'Server error' });
  }
});




// POST METHOD
router.post("/review-request/:requestId",schoolAuthMiddleware,async (req, res) => {
    try {
      const { statusOfRequest } = req.body;
      const { requestId } = req.params;
      const { schoolId } = req;

      if (!["approved", "denied"].includes(statusOfRequest)) {
        return res.status(400).json({ error: "Invalid statusOfRequest" });
      }

      const request = await Request.findById(requestId);
      // Check if the request belongs to the school
      if (request.schoolId.toString() !== schoolId.toString()) {
        return res
          .status(403)
          .json({ error: "Unauthorized to review this request" });
      }
      request.statusOfRequest = statusOfRequest;

      if (
        statusOfRequest === "approved" &&
        request.requestType === "changeRoute"
      ) {
        const child = await Child.findById(request.childId);
        if (!child) {
          return res.status(404).json({ error: "Child not found" });
        }
        child.deviceId = request.newRoute;
        await child.save();
      }
      await request.save();

      const today = new Date();
      const formattedDate = formatDateToDDMMYYYY(today);
      const formattedRequestDate = formatDateToDDMMYYYY(
        new Date(request.requestDate)
      );

      // Assuming notifyParent is a function to send notifications
      const notifyParent = (parentId, message) => {
        // Your notification logic here
        console.log(`Notification to parentId ${parentId}: ${message}`);
      };

      notifyParent(
        request.parentId,
        `Your request has been ${statusOfRequest}.`
      );

      res.status(200).json({
        message: `Request reviewed successfully on ${formattedDate}`,
        request: {
          ...request.toObject(),
          formattedRequestDate,
        },
      });
    } catch (error) {
      console.error("Error reviewing request:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);
router.post('/registerStatus/:parentId/', schoolAuthMiddleware, async (req, res) => {
  try {
    const { parentId } = req.params;
    const { action } = req.body;
    const { schoolId } = req; // Assuming schoolId is added to req by schoolAuthMiddleware

    // Find the parent by ID and check if they belong to the correct school
    const parent = await Parent.findOne({ _id: parentId, schoolId });
    if (!parent) {
      return res.status(404).json({ error: 'Parent not found or does not belong to this school' });
    }

    // Update the registration status based on the action
    if (action === 'approve') {
      parent.statusOfRegister = 'approved';
    } else if (action === 'reject') {
      parent.statusOfRegister = 'rejected';
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }

    await parent.save();

    res.status(200).json({ message: `Registration ${action}d successfully.` });
  } catch (error) {
    console.error('Error during registration status update:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.post('/registerStatus-driver/:driverId/', schoolAuthMiddleware, async (req, res) => {
  try {
    const { driverId } = req.params;
    const { action } = req.body;
    const { schoolId } = req; // Assuming schoolId is added to req by schoolAuthMiddleware

    // Find the driver by ID and check if they belong to the correct school
    const driver = await DriverCollection.findOne({ _id: driverId, schoolId });
    if (!driver) {
      return res.status(404).json({ error: 'driver not found or does not belong to this school' });
    }

    // Update the registration status based on the action
    if (action === 'approve') {
      driver.statusOfRegister = 'approved';
    } else if (action === 'reject') {
      driver.statusOfRegister = 'rejected';
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }

    await driver.save();

    res.status(200).json({ message: `Registration ${action}d successfully.` });
  } catch (error) {
    console.error('Error during registration status update:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.post('/registerStatus-supervisor/:supervisorId/', schoolAuthMiddleware, async (req, res) => {
  try {
    const { supervisorId } = req.params;
    const { action } = req.body;
    const { schoolId } = req; // Assuming schoolId is added to req by schoolAuthMiddleware

    // Find the supervisor by ID and check if they belong to the correct school
    const supervisor = await Supervisor.findOne({ _id: supervisorId, schoolId });
    if (!supervisor) {
      return res.status(404).json({ error: 'supervisor not found or does not belong to this school' });
    }

    // Update the registration status based on the action
    if (action === 'approve') {
      supervisor.statusOfRegister = 'approved';
    } else if (action === 'reject') {
      supervisor.statusOfRegister = 'rejected';
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }

    await supervisor.save();

    res.status(200).json({ message: `Registration ${action}d successfully.` });
  } catch (error) {
    console.error('Error during registration status update:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.post('/add-device', schoolAuthMiddleware, async (req, res) => {
  try {
    const { deviceId, deviceName, schoolName, branchName } = req.body;

    // Validate the required fields
    if (!deviceId || !deviceName || !schoolName || !branchName) {
      return res.status(400).json({ message: 'All fields (deviceId, deviceName, schoolName, branchName) are required' });
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

    // Check if a device with the same ID already exists
    const existingDevice = await Device.findOne({ deviceId });
    if (existingDevice) {
      return res.status(400).json({ message: 'Device with this ID already exists' });
    }

    // Create a new device linked to the school and branch
    const newDevice = new Device({
      deviceId,
      deviceName,
      schoolId: school._id,  // Link to the school's ID
      branchId: branch._id   // Link to the branch's ID
    });

    // Save the device
    await newDevice.save();

    // Update the branch to include the new device
    branch.devices.push(newDevice._id);
    await branch.save();

    // Return success response
    res.status(201).json({ message: 'Device created successfully', device: newDevice });
  } catch (error) {
    console.error('Error adding device:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});




//PUT METHOD
router.put('/update-child/:childId', schoolAuthMiddleware, async (req, res) => {
  const { childId } = req.params;
  const { schoolName, branchName, parentName, email, phone, password, deviceId, deviceName, ...updateFields } = req.body; // Include device info

  try {
    // Find the child by ID
    const child = await Child.findById(childId);
    if (!child) {
      return res.status(404).json({ error: 'Child not found' });
    }

    // Update school and branch if provided
    if (schoolName && branchName) {
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

      // Update the child's school and branch references
      child.schoolId = school._id;
      child.branchId = branch._id;
    }

    // Update deviceId and deviceName if provided
    if (deviceId) {
      child.deviceId = deviceId;
    }
    if (deviceName) {
      child.deviceName = deviceName;
    }

    // Update other child fields
    Object.keys(updateFields).forEach((field) => {
      child[field] = updateFields[field];
    });

    // Update parent information if provided
    if (child.parentId) {
      const parent = await Parent.findById(child.parentId);
      if (parent) {
        if (parentName) parent.parentName = parentName;
        if (email) parent.email = email;
        if (phone) parent.phone = phone;

        // Directly update password if provided (will be hashed on save)
        if (password) {
          parent.password = password; // Save the plain password, it will be hashed in schema
        }

        await parent.save(); // Save updated parent data
      }
    }

    await child.save(); // Save updated child data

    // Fetch updated child data with parent info
    const updatedChild = await Child.findById(childId).lean();
    let parentData = {};
    if (updatedChild.parentId) {
      const parent = await Parent.findById(updatedChild.parentId).lean();
      parentData = {
        parentName: parent ? parent.parentName : null,
        email: parent ? parent.email : null,
        phone: parent ? parent.phone : null,
        parentId: parent ? parent._id : null,
      };
    } else {
      parentData = {
        parentName: null,
        email: null,
        phone: null,
        parentId: null,
      };
    }

    const transformedChild = {
      ...updatedChild,
      ...parentData,
      formattedRegistrationDate: formatDateToDDMMYYYY(new Date(updatedChild.registrationDate)),
    };

    res.status(200).json({ message: 'Child information updated successfully', child: transformedChild });
  } catch (error) {
    console.error('Error updating child information:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.put('/update-parent/:id', schoolAuthMiddleware, async (req, res) => {
  const parentId = req.params.id;
  const { parentName, email, password, phone } = req.body;
  const { schoolId } = req; // Assuming schoolId is added to req by schoolAuthMiddleware

  try {
    // Find the parent by ID and check if they belong to the correct school
    const parent = await Parent.findOne({ _id: parentId, schoolId });
    
    if (!parent) {
      return res.status(404).json({ error: 'Parent not found or does not belong to this school' });
    }

    // Update only the allowed fields
    if (parentName) parent.parentName = parentName;
    if (email) parent.email = email;
    if (phone) parent.phone = phone;
    if (password) parent.password = password; // Ensure you handle password encryption properly

    // Save the updated parent
    await parent.save();
    
    res.status(200).json({
      message: 'Parent updated successfully',
      parent: {
        ...parent.toObject(),
      },
    });
  } catch (error) {
    console.error('Error updating parent:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.put('/update-supervisor/:id', schoolAuthMiddleware, async (req, res) => {
  const { id: supervisorId } = req.params;
  const { schoolName, branchName, deviceId, ...updateFields } = req.body;

  try {
    // Find the supervisor by ID
    const supervisor = await Supervisor.findById(supervisorId);
    if (!supervisor) {
      return res.status(404).json({ error: 'Supervisor not found' });
    }

    // Update school and branch if provided
    if (schoolName && branchName) {
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

      // Update the supervisor's school and branch references
      supervisor.schoolId = school._id;
      supervisor.branchId = branch._id;
    }

    // Update deviceId if provided
    if (deviceId) {
      supervisor.deviceId = deviceId;
    }

    // Update other fields
    Object.keys(updateFields).forEach((field) => {
      supervisor[field] = updateFields[field];
    });

    // Save the updated supervisor
    await supervisor.save();

    // Fetch updated supervisor data with decrypted password
    const updatedSupervisor = await Supervisor.findById(supervisorId).lean();
    let decryptedPassword = '';
    try {
      console.log(`Decrypting password for supervisor: ${updatedSupervisor.supervisorName}, encryptedPassword: ${updatedSupervisor.password}`);
      decryptedPassword = decrypt(updatedSupervisor.password);
    } catch (decryptError) {
      console.error(`Error decrypting password for supervisor: ${updatedSupervisor.supervisorName}`, decryptError);
    }

    const transformedSupervisor = {
      ...updatedSupervisor,
      password: decryptedPassword,
      registrationDate: formatDateToDDMMYYYY(new Date(updatedSupervisor.registrationDate))
    };

    console.log('Updated supervisor data:', JSON.stringify(transformedSupervisor, null, 2));
    res.status(200).json({ message: 'Supervisor information updated successfully', supervisor: transformedSupervisor });
  } catch (error) {
    console.error('Error updating supervisor:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.put('/update-driver/:id', schoolAuthMiddleware, async (req, res) => {
  try {
    const { id: driverId } = req.params;
    const { deviceId, schoolName, branchName, ...updateFields } = req.body;

    // Find the driver by ID
    const driver = await DriverCollection.findById(driverId);
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }

    // Handle school and branch update if both are provided
    if (schoolName && branchName) {
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

      // Update the driver's school and branch references
      driver.schoolId = school._id;
      driver.branchId = branch._id;
    }

    // Update deviceId if provided
    if (deviceId) {
      driver.deviceId = deviceId;
    }

    // Update other fields
    Object.keys(updateFields).forEach((field) => {
      driver[field] = updateFields[field];
    });

    // Save the updated driver
    await driver.save();

    // Fetch updated driver data with decrypted password
    const updatedDriver = await DriverCollection.findById(driverId).lean();
    let decryptedPassword = '';
    try {
      console.log(`Decrypting password for driver: ${updatedDriver.driverName}, encryptedPassword: ${updatedDriver.password}`);
      decryptedPassword = decrypt(updatedDriver.password);
    } catch (decryptError) {
      console.error(`Error decrypting password for driver: ${updatedDriver.driverName}`, decryptError);
    }

    const transformedDriver = {
      ...updatedDriver,
      password: decryptedPassword,
      registrationDate: formatDateToDDMMYYYY(new Date(updatedDriver.registrationDate))
    };

    console.log('Updated driver data:', JSON.stringify(transformedDriver, null, 2));
    res.status(200).json({ message: 'Driver information updated successfully', driver: transformedDriver });
  } catch (error) {
    console.error('Error updating driver:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.put('/edit-device/:actualDeviceId', schoolAuthMiddleware, async (req, res) => {
  try {
    const { actualDeviceId } = req.params; // The MongoDB _id of the device from the URL
    const { deviceId, deviceName, branchName, schoolName } = req.body; // Values from the request body

    // Validate required fields
    if (!deviceId || !deviceName || (branchName && !schoolName)) {
      return res.status(400).json({ message: 'deviceId, deviceName, and optionally branchName and schoolName are required' });
    }

    // Check if the deviceId already exists in another device
    const existingDevice = await Device.findOne({
      deviceId,
      _id: { $ne: actualDeviceId } // Exclude the current device from this check
    });

    if (existingDevice) {
      return res.status(400).json({ message: 'Device with this deviceId already exists' });
    }

    // Find the device by actualDeviceId (MongoDB _id) and update it
    const device = await Device.findById(actualDeviceId);
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    // Update the device fields
    device.deviceId = deviceId;
    device.deviceName = deviceName;

    if (branchName && schoolName) {
      // Find the school and branch where this device should be updated
      const school = await School.findOne({ schoolName: new RegExp(`^${schoolName.trim()}$`, 'i') }).populate('branches');
      if (!school) {
        return res.status(404).json({ message: 'School not found' });
      }

      const branch = school.branches.find(branch => branch.branchName.toLowerCase() === branchName.trim().toLowerCase());
      if (!branch) {
        return res.status(404).json({ message: 'Branch not found in the specified school' });
      }

      // Update the branch to include the updated device (if necessary)
      if (!branch.devices.includes(device._id)) {
        branch.devices.push(device._id);
        await branch.save();
      }
    }

    // Save the updated device
    await device.save();

    // Return success response with the updated device data
    res.status(200).json({ message: 'Device updated successfully', device });
  } catch (error) {
    console.error('Error updating device:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});
router.put('/edit-school/:id', schoolAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolName, username, password, email, schoolMobile } = req.body;

    // Check if a school with the new username or email already exists (but not the current school)
    const existingSchool = await School.findOne({
      _id: { $ne: id }, 
      $or: [{ username }, { email }]
    });
    
    if (existingSchool) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    // Find the school by ID and update the details
    const updatedSchool = await School.findByIdAndUpdate(
      id,
      {
        schoolName,
        username,
        password,
        email,
        schoolMobile
      },
      { new: true, runValidators: true }
    );

    if (!updatedSchool) {
      return res.status(404).json({ error: 'School not found' });
    }

    // Generate a new token if the username has changed (optional, based on your app logic)
    const payload = { id: updatedSchool._id, username: updatedSchool.username };
    const token = generateToken(payload);

    // Respond with the updated school details and token
    res.status(200).json({ response: { ...updatedSchool.toObject(), password: undefined }, token, role: "schooladmin" });
  } catch (error) {
    console.error('Error during school update:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// router.put('/edit-branch/:id', schoolAuthMiddleware, async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { branchName, email, schoolMobile, username, password } = req.body;

//     // Find the branch by ID
//     const existingBranch = await Branch.findById(id);
//     if (!existingBranch) {
//       return res.status(404).json({ error: 'Branch not found' });
//     }

//     // Check if the username is already taken by another branch
//     const duplicateBranch = await Branch.findOne({
//       _id: { $ne: id }, 
//       username 
//     });
    
//     if (duplicateBranch) {
//       return res.status(400).json({ error: 'Username already exists. Please choose a different one.' });
//     }

//     // Update the branch details
//     const updatedBranch = await Branch.findByIdAndUpdate(
//       id,
//       {
//         branchName,
//         email,
//         schoolMobile,
//         username,
//         password
//       },
//       { new: true, runValidators: true }
//     );

//     if (!updatedBranch) {
//       return res.status(404).json({ error: 'Branch not found' });
//     }

//     res.status(200).json({ branch: updatedBranch });
//   } catch (error) {
//     console.error('Error editing branch:', error);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// });
router.put('/edit-branch/:id', schoolAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { branchName, email, schoolMobile, username, password } = req.body;

    // Check if the branch exists
    const existingBranch = await Branch.findById(id);
    if (!existingBranch) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    // Check if the username is already taken by another branch
    const duplicateUsernameBranch = await Branch.findOne({
      _id: { $ne: id }, 
      username 
    });
    if (duplicateUsernameBranch) {
      return res.status(400).json({ error: 'Username already exists. Please choose a different one.' });
    }

    // Update the branch using `findOneAndUpdate`
    const updatedBranch = await Branch.findOneAndUpdate(
      { _id: id },
      { branchName, email, schoolMobile, username, password },
      { new: true, runValidators: true }
    );

    res.status(200).json({ branch: updatedBranch });
  } catch (error) {
    console.error('Error editing branch:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.put('/geofences/:id', schoolAuthMiddleware, async (req, res) => {
  const { schoolId } = req; // Extract schoolId from the authenticated request
  const { name } = req.body; // Get the new name from the request body
  const { id: geofenceId } = req.params; // Get geofence id from the route parameters

  try {
    // Fetch the school and check if it exists
    const school = await School.findById(schoolId).select('schoolName');
    if (!school) {
      return res.status(404).json({ message: 'School not found' });
    }

    // Fetch branches associated with the school
    const branches = await Branch.find({ schoolId }).select('_id');

    // Get the devices associated with the school's branches
    const devices = await Device.find({ branchId: { $in: branches.map(branch => branch._id) } })
      .select('deviceId');

    // Extract deviceIds for searching geofences
    const deviceIds = devices.map(device => device.deviceId);

    // Find the geofence by its ID and ensure it's associated with the school's devices
    const geofence = await Geofencing.findOne({ _id: geofenceId, deviceId: { $in: deviceIds } });
    if (!geofence) {
      return res.status(404).json({ message: 'Geofence not found or unauthorized' });
    }

    // Update only the 'name' field of the geofence
    geofence.name = name;

    // Save the updated geofence
    const updatedGeofence = await geofence.save();

    // Respond with the updated geofence details
    res.status(200).json({
      message: 'Geofence updated successfully',
      geofence: updatedGeofence
    });
  } catch (error) {
    console.error('Error updating geofence:', error);
    res.status(500).json({ message: 'Error updating geofence', error });
  }
});




// DELETE METHOD
router.delete('/delete/child/:childId', schoolAuthMiddleware, async (req, res) => {
  const { childId } = req.params;
  const { schoolId } = req; // Assuming schoolId is added to req by schoolAuthMiddleware

  try {
    // Find the child by ID and check if they belong to the correct school
    const child = await Child.findOne({ _id: childId, schoolId }).lean();
    if (!child) {
      return res.status(404).json({ error: 'Child not found or does not belong to this school' });
    }

    let parentData = {};
    if (child.parentId) {
      // Find the parent and ensure they belong to the same school
      const parent = await Parent.findOne({ _id: child.parentId, schoolId }).lean();
      if (parent) {
        parentData = {
          parentName: parent.parentName,
          email: parent.email,
          phone: parent.phone,
          parentId: parent._id,
        };

        // Check if the parent has any other children
        const childCount = await Child.countDocuments({ parentId: child.parentId, schoolId });
        if (childCount === 1) {
          await Parent.findByIdAndDelete(child.parentId);
        }
      }
    }

    // Delete the child
    await Child.findByIdAndDelete(childId);

    console.log('Deleted child data:', JSON.stringify(child, null, 2));
    if (parentData.parentId) {
      console.log('Associated parent data:', JSON.stringify(parentData, null, 2));
    }

    res.status(200).json({
      message: 'Child deleted successfully',
      child,
      parent: parentData,
    });
  } catch (error) {
    console.error('Error deleting child:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.delete('/delete-parent/:id', schoolAuthMiddleware, async (req, res) => {
  const parentId = req.params.id;
  const { schoolId } = req;

  try {
    // Find the parent by ID and ensure they belong to the correct school
    const parent = await Parent.findOne({ _id: parentId, schoolId }).lean();
    if (!parent) {
      return res.status(404).json({ error: 'Parent not found or does not belong to this school' });
    }

    // Delete all children associated with the parent and ensure they belong to the same school
    await Child.deleteMany({ _id: { $in: parent.children }, schoolId });

    // Delete the parent
    await Parent.findByIdAndDelete(parentId);

    res.status(200).json({ message: 'Parent and associated children deleted successfully' });
  } catch (error) {
    console.error('Error deleting parent:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.delete('/delete-driver/:id', schoolAuthMiddleware, async (req, res) => {
  try {
    const { id: driverId } = req.params;
    const schoolId = req.schoolId; // Get the schoolId from the middleware
    
    // Find and delete the driver by ID and schoolId
    const deletedDriver = await DriverCollection.findOneAndDelete({ _id: driverId, schoolId });

    if (!deletedDriver) {
      return res.status(404).json({ error: 'Driver not found or does not belong to your school' });
    }

    console.log('Deleted driver data:', JSON.stringify(deletedDriver, null, 2));
    res.status(200).json({ message: 'Driver deleted successfully' });
  } catch (error) {
    console.error('Error deleting driver:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.delete('/delete-supervisor/:id', schoolAuthMiddleware, async (req, res) => {
  try {
    const { id: supervisorId } = req.params;
    const schoolId = req.schoolId; // Get the schoolId from the middleware
    
    // Find and delete the supervisor by ID and schoolId
    const deletedSupervisor = await Supervisor.findOneAndDelete({ _id: supervisorId, schoolId });

    if (!deletedSupervisor) {
      return res.status(404).json({ error: 'Supervisor not found or does not belong to your school' });
    }

    console.log('Deleted supervisor data:', JSON.stringify(deletedSupervisor, null, 2));
    res.status(200).json({ message: 'Supervisor deleted successfully' });
  } catch (error) {
    console.error('Error deleting supervisor:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.delete('/delete-school/:id', schoolAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    // Find the school by ID and delete it
    const deletedSchool = await School.findByIdAndDelete(id);
    
    if (!deletedSchool) {
      return res.status(404).json({ error: 'School not found' });
    }

    res.status(200).json({ message: 'School deleted successfully', school: deletedSchool });
  } catch (error) {
    console.error('Error deleting school:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.delete('/delete-branch/:id', schoolAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params; // Corrected from branchId to id

    // Find the branch by ID
    const branch = await Branch.findById(id); // Using id to find the branch
    if (!branch) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    // Delete all related data
    const parents = await Parent.find({ branchId: branch._id });

    for (const parent of parents) {
      // Delete children associated with each parent
      await Child.deleteMany({ parentId: parent._id });
    }

    // Delete parents associated with the branch
    await Parent.deleteMany({ branchId: branch._id });

    // Delete supervisors and drivers associated with the branch
    await Supervisor.deleteMany({ branchId: branch._id });
    await DriverCollection.deleteMany({ branchId: branch._id });

    // Delete the branch itself using deleteOne()
    await Branch.deleteOne({ _id: id });

    res.status(200).json({ message: 'Branch and all related data deleted successfully' });
  } catch (error) {
    console.error('Error during branch deletion:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.delete('/delete-device/:actualDeviceId', schoolAuthMiddleware, async (req, res) => {
  try {
    const { actualDeviceId } = req.params;

    // Find the device by actualDeviceId (which is the MongoDB _id)
    const device = await Device.findById(actualDeviceId);
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    // Delete the device by actualDeviceId (MongoDB _id)
    await Device.deleteOne({ _id: actualDeviceId });

    // Return success response
    res.status(200).json({ message: 'Device deleted successfully' });
  } catch (error) {
    console.error('Error deleting device:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});
router.delete('/geofences/:id',schoolAuthMiddleware, async (req, res) => {
  const { id: geofenceId } = req.params; // Get geofence id from the route parameters

  try {
    // Find the geofence by its ID and delete it
    const deletedGeofence = await Geofencing.findByIdAndDelete(geofenceId);

    // Check if the geofence was found and deleted
    if (!deletedGeofence) {
      return res.status(404).json({ message: 'Geofence not found' });
    }

    // Respond with a success message
    res.status(200).json({
      message: 'Geofence deleted successfully',
      deletedGeofence: deletedGeofence // Optional: include the deleted geofence details
    });
  } catch (error) {
    console.error('Error deleting geofence:', error);
    res.status(500).json({ message: 'Error deleting geofence', error });
  }
});


module.exports = router;
