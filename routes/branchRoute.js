const express = require("express");
const router = express.Router();
const Child = require("../models/child");
const Parent = require("../models/Parent");
const { branchAuthMiddleware,generateToken } = require("../jwt");
const Branch = require("../models/branch");
const DriverCollection = require('../models/driver');
const Supervisor = require("../models/supervisor");
const Attendance = require("../models/attendence");
const Request = require("../models/request");
const { decrypt } = require('../models/cryptoUtils');
const { formatDateToDDMMYYYY } = require('../utils/dateUtils');
const School = require("../models/school");

// Login route for branches
router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    // Find the branch by username
    const branch = await Branch.findOne({ username });
    if (!branch) {
      return res.status(400).json({ error: "Invalid username or password" });
    }

    // Compare the provided password with the stored hashed password
    const isMatch = await branch.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid username or password" });
    }

    // Generate the token using the existing function
    const token = generateToken({
      id: branch._id,
      username: branch.username,
      role: "branch",
    });

    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      role: "branch",
    });
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ error: "Server error" });
  }
});


// Get all children for a specific branch (Authenticated branch user)
router.get("/read/all-children", branchAuthMiddleware, async (req, res) => {
  try {
    const { branchId } = req;

    // Fetch branch details to get the branchName
    const branch = await Branch.findById(branchId).lean();
    if (!branch) {
      return res.status(404).json({ error: "Branch not found" });
    }
    const branchName = branch.branchName; // Ensure branchName is correctly retrieved
    console.log("Branch data:", JSON.stringify(branch, null, 2)); // Log branch data

    // Fetch children for the specified branch
    const children = await Child.find({ branchId }).lean();
    console.log("Raw children data:", JSON.stringify(children, null, 2));

    const transformedChildren = await Promise.all(
      children.map(async (child) => {
        // Always retrieve parent data even if registration status is rejected
        const parent = await Parent.findById(child.parentId).lean();
        if (!parent) {
          return null;
        }

        console.log(
          "Parent data before decryption:",
          JSON.stringify(parent, null, 2)
        );

        let decryptedPassword;
        try {
          decryptedPassword = decrypt(parent.password);
          console.log(
            `Decrypted password for parent ${parent.parentName}: ${decryptedPassword}`
          );
        } catch (decryptError) {
          console.error(
            `Error decrypting password for parent ${parent.parentName}`,
            decryptError
          );
          return null;
        }

        const parentData = {
          parentName: parent.parentName,
          email: parent.email,
          phone: parent.phone,
          parentId: parent._id,
          password: decryptedPassword, // Include decrypted password
          statusOfRegister: parent.statusOfRegister // Include the registration status
        };

        return {
          childId: child._id,
          childName: child.childName,
          class: child.class,
          rollno: child.rollno,
          section: child.section,
          schoolName: child.schoolName,
          branchName,
          dateOfBirth: child.dateOfBirth,
          childAge: child.childAge,
          pickupPoint: child.pickupPoint,
          busName: child.busName,
          gender: child.gender,
          parentId: child.parentId,
          deviceId: child.deviceId,
          registrationDate: child.registrationDate,
          formattedRegistrationDate: formatDateToDDMMYYYY(new Date(child.registrationDate)),
          ...parentData
        };
      })
    );

    const filteredChildren = transformedChildren.filter(
      (child) => child !== null
    );

    console.log("Transformed children data:", JSON.stringify(filteredChildren, null, 2));

    res.status(200).json({ branchName, children: filteredChildren });
  } catch (error) {
    console.error("Error fetching children:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});




// Get parents for a specific branch
router.get("/parents", branchAuthMiddleware, async (req, res) => {
  try {
    const { branchId } = req;

    // Fetch branch details to get the branchName
    const branch = await Branch.findById(branchId).lean();
    if (!branch) {
      return res.status(404).json({ error: "Branch not found" });
    }
    const branchName = branch.branch;

    // Fetch all parents for the specific branch
    const parents = await Parent.find({ branchId })
      .populate("children")
      .lean();

    const transformedParents = await Promise.all(
      parents.map(async (parent) => {
        let decryptedPassword;
        try {
          decryptedPassword = decrypt(parent.password); // Decrypt the password
          console.log(
            `Decrypted password for parent ${parent.parentName}: ${decryptedPassword}`
          );
        } catch (decryptError) {
          console.error(
            `Error decrypting password for parent ${parent.parentName}`,
            decryptError
          );
          return null;
        }

        // Format child dates
        const transformedChildren = parent.children.map((child) => ({
          ...child,
          formattedRegistrationDate: formatDateToDDMMYYYY(
            new Date(child.registrationDate)
          ),
        }));

        return {
          ...parent,
          password: decryptedPassword,
          formattedRegistrationDate: formatDateToDDMMYYYY(
            new Date(parent.parentRegistrationDate)
          ),
          children: transformedChildren,
        };
      })
    );

    const filteredParents = transformedParents.filter(
      (parent) => parent !== null
    );

    // Structure the response with branchName as the top-level key
    const response = {
      branchName: branchName,
      parents: filteredParents,
    };

    res.status(200).json(response);
  } catch (error) {
    console.error("Error fetching parents:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


// Fetch pending requests for a specific branch
router.get("/pending-requests", branchAuthMiddleware, async (req, res) => {
  try {
    const { branchId } = req;

    console.log("Branch ID:", branchId); // Debugging

    if (!branchId) {
      return res.status(400).json({ error: "Branch ID not provided" });
    }

    // Fetch all pending requests for the specific branch
    const requests = await Request.find({
      statusOfRequest: "pending",
      branchId,
    })
      .populate({
        path: "childId",
        populate: {
          path: "schoolId branchId",
          select: "schoolName branchName", // Only include the names
        },
        select: "childName class schoolId branchId", // Ensure we get the schoolId and branchId
      })
      .populate("parentId", "parentName email phone")
      .lean();

    console.log("Fetched Requests:", requests); // Debugging

    // Filter and format requests
    const validRequests = requests.filter(
      (request) => request.parentId && request.childId
    );

    const formattedRequests = validRequests.map((request) => {
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
        branchName: request.childId.branchId?.branchName || null, // Include branchName
        schoolName: request.childId.schoolId?.schoolName || null, // Include schoolName
        requestType: request.requestType,
        requestDate: request.requestDate,
        formattedRequestDate: request.requestDate
          ? formatDateToDDMMYYYY(new Date(request.requestDate))
          : null,
      };

      if (request.requestType === "leave") {
        formattedRequest.startDate = request.startDate || null;
        formattedRequest.endDate = request.endDate || null;
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

      return formattedRequest;
    });

    res.status(200).json({
      requests: formattedRequests,
    });
  } catch (error) {
    console.error("Error fetching requests:", error);
    res.status(500).json({
      error: "Internal server error",
    });
  }
});

// Get all approved requests for a branch
router.get("/approved-requests", branchAuthMiddleware, async (req, res) => {
  try {
    const { branchId } = req;

    // Fetch the branch details
    const branch = await Branch.findById(branchId).lean();
    const branchName = branch ? branch.branchName : null;

    // Fetch the school details using schoolId from the branch document
    const school = branch ? await School.findById(branch.schoolId).lean() : null;
    const schoolName = school ? school.schoolName : null;

    // Fetch all approved requests for the specific branch
    const requests = await Request.find({
      statusOfRequest: "approved",
      branchId,
    })
      .populate("parentId", "parentName email phone")
      .populate("childId", "childName class")
      .lean();

    // Filter out requests where the parent or child does not exist
    const validRequests = requests.filter(
      (request) => request.parentId && request.childId
    );

    // Format the request data based on the request type
    const formattedRequests = validRequests.map((request) => {
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
        requestDate: request.requestDate,
        formattedRequestDate: request.requestDate
          ? formatDateToDDMMYYYY(new Date(request.requestDate))
          : null,
        schoolName: schoolName, // Include schoolName
        branchName: branchName, // Include branchName
      };

      // Add fields conditionally based on the request type
      if (request.requestType === "leave") {
        formattedRequest.startDate = request.startDate || null;
        formattedRequest.endDate = request.endDate || null;
        formattedRequest.newRoute = null; // Ensure newRoute is not included for leave requests
      } else if (request.requestType === "changeRoute") {
        formattedRequest.newRoute = request.newRoute || null;
        formattedRequest.startDate = null; // Ensure startDate and endDate are not included for changeRoute requests
        formattedRequest.endDate = null;
      } else {
        formattedRequest.startDate = null;
        formattedRequest.endDate = null;
        formattedRequest.newRoute = null;
      }

      return formattedRequest;
    });

    // Send the formatted requests as a JSON response
    res.status(200).json({
      requests: formattedRequests,
    });
  } catch (error) {
    console.error("Error fetching requests:", error);
    res.status(500).json({
      error: "Internal server error",
    });
  }
});
// Get all denied requests for a branch
router.get("/denied-requests", branchAuthMiddleware, async (req, res) => {
  try {
    const { branchId } = req;

    // Fetch the branch details
    const branch = await Branch.findById(branchId).lean();
    const branchName = branch ? branch.branchName : null;

    // Fetch the school details using schoolId from the branch document
    const school = branch ? await School.findById(branch.schoolId).lean() : null;
    const schoolName = school ? school.schoolName : null;

    // Fetch all denied requests for the specific branch
    const deniedRequests = await Request.find({
      statusOfRequest: "denied",
      branchId,
    })
      .populate("parentId", "parentName email phone")
      .populate("childId", "childName deviceId class")
      .lean();

    // Filter out requests where parentId or childId is null or not populated
    const validRequests = deniedRequests.filter(
      (request) => request.parentId && request.childId
    );

    // Format the request data
    const formattedRequests = validRequests.map((request) => ({
      childId: request.childId._id,
      childName: request.childId.childName,
      deviceId: request.childId.deviceId,
      class: request.childId.class,
      statusOfRequest: request.statusOfRequest,
      parentName: request.parentId.parentName,
      email: request.parentId.email,
      phone: request.parentId.phone,
      requestDate: request.requestDate,
      formattedRequestDate: request.requestDate
        ? formatDateToDDMMYYYY(new Date(request.requestDate))
        : null, // Formatted request date
      schoolName: schoolName, // Include schoolName
      branchName: branchName, // Include branchName
    }));

    res.status(200).json({ requests: formattedRequests });
  } catch (error) {
    console.error("Error fetching denied requests:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


// Get all drivers for a branch
router.get("/read/alldrivers", branchAuthMiddleware, async (req, res) => {
  const { branchId } = req;

  try {
    // Fetch drivers associated with the specific branch and populate the branch name and school name
    const drivers = await DriverCollection.find({ branchId })
      .populate({
        path: 'branchId',
        select: 'branchName'
      })
      .populate({
        path: 'schoolId', // Assuming you have a schoolId field in DriverCollection schema
        select: 'schoolName'
      })
      .lean(); // Use lean() for better performance

    const driverData = drivers
      .map((driver) => {
        try {
          console.log(
            `Decrypting password for driver: ${driver.driverName}, encryptedPassword: ${driver.password}`
          );
          const decryptedPassword = decrypt(driver.password);
          return {
            id: driver._id,
            driverName: driver.driverName,
            address: driver.address,
            phone_no: driver.phone_no,
            email: driver.email,
            deviceId: driver.deviceId,
            password: decryptedPassword,
            registrationDate: driver.registrationDate,
            formattedRegistrationDate: formatDateToDDMMYYYY(
              new Date(driver.registrationDate)
            ),
            branchName: driver.branchId ? driver.branchId.branchName : 'Branch not found', // Include branch name
            schoolName: driver.schoolId ? driver.schoolId.schoolName : 'School not found', // Include school name
          };
        } catch (decryptError) {
          console.error(
            `Error decrypting password for driver: ${driver.driverName}`,
            decryptError
          );
          return null;
        }
      })
      .filter((driver) => driver !== null);

    res.status(200).json({ drivers: driverData });
  } catch (error) {
    console.error("Error fetching drivers:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


// Get all supervisors for a specific branch within a school
router.get("/read/allsupervisors", branchAuthMiddleware, async (req, res) => {
  const { branchId } = req;

  try {
    // Fetch supervisors associated with the specific branch
    const supervisors = await Supervisor.find({ branchId })
      .populate("branchId", "branchName") // Populate branchName
      .populate("schoolId", "schoolName") // Populate schoolName
      .lean();

    const supervisorData = supervisors.map((supervisor) => {
      try {
        console.log(
          `Decrypting password for supervisor: ${supervisor.supervisorName}, encryptedPassword: ${supervisor.password}`
        );
        const decryptedPassword = decrypt(supervisor.password);
        return {
          id: supervisor._id,
          supervisorName: supervisor.supervisorName,
          address: supervisor.address,
          phone_no: supervisor.phone_no,
          email: supervisor.email,
          deviceId: supervisor.deviceId,
          password: decryptedPassword,
          registrationDate: supervisor.registrationDate,
          formattedRegistrationDate: formatDateToDDMMYYYY(
            new Date(supervisor.registrationDate)
          ),
          branchName: supervisor.branchId.branchName, // Include the branch name
          schoolName: supervisor.schoolId.schoolName, // Include the school name
        };
      } catch (decryptError) {
        console.error(
          `Error decrypting password for supervisor: ${supervisor.supervisorName}`,
          decryptError
        );
        return null;
      }
    }).filter((supervisor) => supervisor !== null);

    res.status(200).json({ supervisors: supervisorData });
  } catch (error) {
    console.error("Error fetching supervisors:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
// Get data by deviceId
router.get("/read/data-by-deviceId", branchAuthMiddleware, async (req, res) => {
  const { deviceId } = req.query;
  const { branchId } = req; // Get the branchId from the authenticated request

  if (!deviceId) {
    return res.status(400).json({ error: "Device ID is required" });
  }

  try {
    // Fetch Supervisor data associated with the branchId
    const supervisor = await Supervisor.findOne({ deviceId, branchId }).lean();
    let supervisorData = {};
    if (supervisor) {
      try {
        console.log(
          `Decrypting password for supervisor: ${supervisor.supervisorName}, encryptedPassword: ${supervisor.password}`
        );
        const decryptedPassword = decrypt(supervisor.password);
        supervisorData = {
          id: supervisor._id,
          supervisorName: supervisor.supervisorName,
          address: supervisor.address,
          phone_no: supervisor.phone_no,
          email: supervisor.email,
          deviceId: supervisor.deviceId,
          password: decryptedPassword,
          registrationDate: formatDateToDDMMYYYY(
            new Date(supervisor.registrationDate)
          ),
          branchName: supervisor.branchId
            ? supervisor.branchId.branchName
            : null, // Assuming branchId is populated
        };
      } catch (decryptError) {
        console.error(
          `Error decrypting password for supervisor: ${supervisor.supervisorName}`,
          decryptError
        );
      }
    }

    // Fetch Driver data associated with the branchId
    const driver = await DriverCollection.findOne({
      deviceId,
      branchId,
    }).lean();
    let driverData = {};
    if (driver) {
      try {
        console.log(
          `Decrypting password for driver: ${driver.driverName}, encryptedPassword: ${driver.password}`
        );
        const decryptedPassword = decrypt(driver.password);
        driverData = {
          id: driver._id,
          driverName: driver.driverName,
          address: driver.address,
          phone_no: driver.phone_no,
          email: driver.email,
          deviceId: driver.deviceId,
          password: decryptedPassword,
          registrationDate: formatDateToDDMMYYYY(
            new Date(driver.registrationDate)
          ),
          branchName: driver.branchId ? driver.branchId.branchName : null, // Assuming branchId is populated
        };
      } catch (decryptError) {
        console.error(
          `Error decrypting password for driver: ${driver.driverName}`,
          decryptError
        );
      }
    }

    // Fetch Child data associated with the branchId
    const children = await Child.find({ deviceId, branchId }).lean();
    const transformedChildren = await Promise.all(
      children.map(async (child) => {
        let parentData = {};
        if (child.parentId) {
          const parent = await Parent.findById(child.parentId).lean();
          parentData = {
            parentName: parent ? parent.parentName : null,
            email: parent ? parent.email : null,
            phone: parent ? parent.phone : null,
            parentId: parent ? parent._id : null,
          };
        }

        return {
          ...child,
          ...parentData,
          formattedRegistrationDate: formatDateToDDMMYYYY(
            new Date(child.registrationDate)
          ),
          branchName: child.branchId ? child.branchId.branchName : null, // Assuming branchId is populated
        };
      })
    );

    // Combine results into desired structure
    const responseData = {
      deviceId: deviceId,
      data: {
        childData: transformedChildren,
        driverData: driverData,
        supervisorData: supervisorData,
      },
    };

    res.status(200).json(responseData);
  } catch (error) {
    console.error("Error fetching data by deviceId:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Route to get attendance data for admin dashboard
const convertDate = (dateStr) => {
  const dateParts = dateStr.split("-");
  const jsDate = new Date(`${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`);
  return {
    date: dateStr,
    originalDate: jsDate,
  };
};
// Pickup/Drop Status
router.get("/pickup-drop-status", branchAuthMiddleware, async (req, res) => {
  try {
    // Extract the branchId from the request (set by the branchAuthMiddleware)
    const branchId = req.branchId;

    // Fetch attendance records only for the children associated with this branchId
    const attendanceRecords = await Attendance.find({})
      .populate({
        path: "childId",
        match: { branchId }, // Filter children by branchId
        populate: [
          { path: "parentId", select: "phone" }, // Populate parentId to get parent's phone
          { path: "branchId", select: "branchName" }, // Populate branchId to get branch name
          { path: "schoolId", select: "schoolName" } // Populate schoolId to get school name
        ]
      })
      .lean();

    // Filter and map the data for the response
    const childrenData = attendanceRecords
      .filter(record => record.childId && record.childId.parentId)
      .map(record => {
        const { date, originalDate } = convertDate(record.date);

        return {
          _id: record.childId._id,
          childName: record.childId.childName,
          class: record.childId.class,
          rollno: record.childId.rollno,
          section: record.childId.section,
          parentId: record.childId.parentId._id,
          phone: record.childId.parentId.phone,
          branchName: record.childId.branchId ? record.childId.branchId.branchName : "Branch not found", // Include branch name
          schoolName: record.childId.schoolId ? record.childId.schoolId.schoolName : "School not found", // Include school name
          pickupStatus: record.pickup,
          pickupTime: record.pickupTime,
          deviceId: record.childId.deviceId,
          pickupPoint: record.childId.pickupPoint,
          dropStatus: record.drop,
          dropTime: record.dropTime,
          formattedDate: date,
          date: originalDate
        };
      });

    res.status(200).json({ children: childrenData });
  } catch (error) {
    console.error("Error fetching attendance data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Present Children
router.get("/present-children", branchAuthMiddleware, async (req, res) => {
  try {
    // Extract the branchId from the request (set by the branchAuthMiddleware)
    const branchId = req.branchId;

    // Fetch attendance records for children present at pickup and associated with this branchId
    const attendanceRecords = await Attendance.find({ pickup: true })
      .populate({
        path: "childId",
        match: { branchId }, // Filter children by branchId
        populate: [
          { path: "parentId", select: "phone" }, // Populate parentId to get parent's phone
          { path: "branchId", select: "branchName" }, // Populate branchId to get branch name
          { path: "schoolId", select: "schoolName" } // Populate schoolId to get school name
        ]
      })
      .lean();

    // Filter and map the data for the response
    const childrenData = attendanceRecords
      .filter(record => record.childId && record.childId.parentId)
      .map(record => {
        const { date, originalDate } = convertDate(record.date);

        return {
          _id: record.childId._id,
          childName: record.childId.childName,
          class: record.childId.class,
          rollno: record.childId.rollno,
          section: record.childId.section,
          parentId: record.childId.parentId._id,
          phone: record.childId.parentId.phone,
          pickupStatus: record.pickup,
          pickupTime: record.pickupTime,
          deviceId: record.childId.deviceId,
          pickupPoint: record.childId.pickupPoint,
          branchName: record.childId.branchId ? record.childId.branchId.branchName : 'N/A',
          schoolName: record.childId.schoolId ? record.childId.schoolId.schoolName : 'N/A',
          formattedDate: date,
          date: originalDate,
        };
      });

    res.status(200).json({ children: childrenData });
  } catch (error) {
    console.error("Error fetching present pickup data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Absent Children
router.get("/absent-children", branchAuthMiddleware, async (req, res) => {
  try {
    // Extract the branchId from the request (set by the branchAuthMiddleware)
    const branchId = req.branchId;

    // Fetch attendance records for children absent at pickup and associated with this branchId
    const attendanceRecords = await Attendance.find({ pickup: false })
      .populate({
        path: "childId",
        match: { branchId }, // Filter children by branchId
        populate: [
          { path: "parentId", select: "phone" }, // Populate parentId to get parent's phone
          { path: "branchId", select: "branchName" }, // Populate branchId to get branch name
          { path: "schoolId", select: "schoolName" } // Populate schoolId to get school name
        ]
      })
      .lean();

    // Filter and map the data for the response
    const childrenData = attendanceRecords
      .filter(record => record.childId && record.childId.parentId)
      .map(record => {
        const { date, originalDate } = convertDate(record.date);

        return {
          _id: record.childId._id,
          childName: record.childId.childName,
          class: record.childId.class,
          rollno: record.childId.rollno,
          section: record.childId.section,
          parentId: record.childId.parentId._id,
          phone: record.childId.parentId.phone,
          pickupStatus: record.pickup,
          pickupTime: record.pickupTime,
          deviceId: record.childId.deviceId,
          pickupPoint: record.childId.pickupPoint,
          branchName: record.childId.branchId ? record.childId.branchId.branchName : 'N/A',
          schoolName: record.childId.schoolId ? record.childId.schoolId.schoolName : 'N/A',
          formattedDate: date,
          date: originalDate,
        };
      });

    res.status(200).json({ children: childrenData });
  } catch (error) {
    console.error("Error fetching absent children data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


router.get("/status/:childId", branchAuthMiddleware, async (req, res) => {
  try {
    const { childId } = req.params;
    const branchId = req.branchId; // Extract the branchId from the request

    // Find the child within the specified branch and populate related fields
    const child = await Child.findOne({ _id: childId, branchId })
      .populate('parentId') // Populate parent details
      .populate('schoolId') // Populate school details
      .populate({
        path: 'branchId', // Populate branch details
        select: 'branchName'
      })
      .lean(); // Convert to plain JavaScript object for easier manipulation

    if (!child) {
      return res.status(404).json({ message: "Child not found" });
    }

    const parent = child.parentId;
    const school = child.schoolId;
    const branch = child.branchId;

    // Fetch the most recent attendance record for the child
    const attendance = await Attendance.findOne({ childId })
      .sort({ date: -1 })
      .limit(1);

    // Fetch the most recent request for the child
    const request = await Request.findOne({ childId })
      .sort({ requestDate: -1 })
      .limit(1);

    // Fetch the supervisor based on deviceId and branchId
    let supervisor = null;
    if (child.deviceId) {
      supervisor = await Supervisor.findOne({
        deviceId: child.deviceId,
        branchId,
      });
    }

    // Construct the response object
    const response = {
      schoolName: school ? school.schoolName : 'Unknown School',
      students: [{
        childName: child.childName,
        childClass: child.class,
        parentName: parent ? parent.parentName : null,
        parentNumber: parent ? parent.phone : null,
        pickupStatus: attendance
          ? attendance.pickup
            ? "Present"
            : "Absent"
          : null,
        dropStatus: attendance ? (attendance.drop ? "Present" : "Absent") : null,
        pickupTime: attendance ? attendance.pickupTime : null,
        dropTime: attendance ? attendance.dropTime : null,
        date: attendance ? attendance.date : null,
        requestType: request ? request.requestType : null,
        startDate: request ? request.startDate || null : null,
        endDate: request ? request.endDate || null : null,
        reason: request ? request.reason || null : null,
        newRoute: request ? request.newRoute || null : null,
        statusOfRequest: request ? request.statusOfRequest : null,
        requestDate: request ? formatDateToDDMMYYYY(request.requestDate) : null,
        supervisorName: supervisor ? supervisor.supervisorName : null,
        branchName: branch ? branch.branchName : 'Unknown Branch', // Include branchName inside the student array
        schoolName: school ? school.schoolName : 'Unknown School' // Include schoolName inside the student array
      }]
    };

    // Send the response
    res.json(response);
  } catch (error) {
    console.error("Error fetching child status:", error);
    res.status(500).json({ message: "Server error" });
  }
});





// POST METHOD
// Review request
router.post("/review-request/:requestId",branchAuthMiddleware,async (req, res) => {
    try {
      const { statusOfRequest } = req.body;
      const { requestId } = req.params;
      const { branchId } = req; // Use branchId from the authenticated request

      if (!["approved", "denied"].includes(statusOfRequest)) {
        return res.status(400).json({ error: "Invalid statusOfRequest" });
      }

      const request = await Request.findById(requestId);
      // Check if the request belongs to the branch
      if (request.branchId.toString() !== branchId.toString()) {
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
// POST METHOD
// Registration status
router.post("/registerStatus/:parentId/",branchAuthMiddleware,async (req, res) => {
    try {
      const { parentId } = req.params;
      const { action } = req.body;
      const { branchId } = req; // Use branchId from the authenticated request

      // Find the parent by ID and check if they belong to the correct branch
      const parent = await Parent.findOne({ _id: parentId, branchId });
      if (!parent) {
        return res
          .status(404)
          .json({
            error: "Parent not found or does not belong to this branch",
          });
      }

      // Update the registration status based on the action
      if (action === "approve") {
        parent.statusOfRegister = "approved";
      } else if (action === "reject") {
        parent.statusOfRegister = "rejected";
      } else {
        return res.status(400).json({ error: "Invalid action" });
      }

      await parent.save();

      res
        .status(200)
        .json({ message: `Registration ${action}d successfully.` });
    } catch (error) {
      console.error("Error during registration status update:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);
// PUT METHOD
// Update child information
router.put("/update-child/:childId", branchAuthMiddleware, async (req, res) => {
  const { childId } = req.params;
  const { deviceId, ...updateFields } = req.body;
  const { branchId } = req; // Assuming branchId is added to req by branchAuthMiddleware

  try {
    // Find the child by ID and check if they belong to the correct branch
    const child = await Child.findOne({ _id: childId, branchId });
    if (!child) {
      return res
        .status(404)
        .json({ error: "Child not found or does not belong to this branch" });
    }

    // Update fields
    if (deviceId) {
      child.deviceId = deviceId;
    }
    Object.keys(updateFields).forEach((field) => {
      child[field] = updateFields[field];
    });
    await child.save();

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
      formattedRegistrationDate: formatDateToDDMMYYYY(
        new Date(updatedChild.registrationDate)
      ),
    };

    res
      .status(200)
      .json({
        message: "Child information updated successfully",
        child: transformedChild,
      });
  } catch (error) {
    console.error("Error updating child information:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
// PUT METHOD
// Update parent information
router.put("/update-parent/:id", branchAuthMiddleware, async (req, res) => {
  const parentId = req.params.id;
  const { parentName, email, password, phone } = req.body;
  const { branchId } = req; // Assuming branchId is added to req by branchAuthMiddleware

  try {
    // Find the parent by ID and check if they belong to the correct branch
    const parent = await Parent.findOne({ _id: parentId, branchId });

    if (!parent) {
      return res
        .status(404)
        .json({ error: "Parent not found or does not belong to this branch" });
    }

    // Update only the allowed fields
    if (parentName) parent.parentName = parentName;
    if (email) parent.email = email;
    if (phone) parent.phone = phone;
    if (password) parent.password = password; // Ensure you handle password encryption properly

    // Save the updated parent
    await parent.save();

    res.status(200).json({
      message: "Parent updated successfully",
      parent: {
        ...parent.toObject(),
      },
    });
  } catch (error) {
    console.error("Error updating parent:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
// PUT METHOD
// Update supervisor information
router.put("/update-supervisor/:id", branchAuthMiddleware, async (req, res) => {
  try {
    const { id: supervisorId } = req.params;
    const branchId = req.branchId; // Get the branchId from the middleware
    const { deviceId, ...updateFields } = req.body;

    // Find the supervisor by ID and branchId
    const supervisor = await Supervisor.findOne({
      _id: supervisorId,
      branchId,
    });
    if (!supervisor) {
      return res.status(404).json({ error: "Supervisor not found" });
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
    let decryptedPassword = "";
    try {
      console.log(
        `Decrypting password for supervisor: ${updatedSupervisor.supervisorName}, encryptedPassword: ${updatedSupervisor.password}`
      );
      decryptedPassword = decrypt(updatedSupervisor.password);
    } catch (decryptError) {
      console.error(
        `Error decrypting password for supervisor: ${updatedSupervisor.supervisorName}`,
        decryptError
      );
    }

    const transformedSupervisor = {
      ...updatedSupervisor,
      password: decryptedPassword,
      registrationDate: formatDateToDDMMYYYY(
        new Date(updatedSupervisor.registrationDate)
      ),
    };

    console.log(
      "Updated supervisor data:",
      JSON.stringify(transformedSupervisor, null, 2)
    );
    res
      .status(200)
      .json({
        message: "Supervisor information updated successfully",
        supervisor: transformedSupervisor,
      });
  } catch (error) {
    console.error("Error updating supervisor:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
// PUT METHOD
// Update driver information
router.put("/update-driver/:id", branchAuthMiddleware, async (req, res) => {
  try {
    const { id: driverId } = req.params;
    const branchId = req.branchId; // Get the branchId from the middleware
    const { deviceId, ...updateFields } = req.body;

    // Find the driver by ID and branchId
    const driver = await DriverCollection.findOne({ _id: driverId, branchId });
    if (!driver) {
      return res.status(404).json({ error: "Driver not found" });
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
    let decryptedPassword = "";
    try {
      console.log(
        `Decrypting password for driver: ${updatedDriver.driverName}, encryptedPassword: ${updatedDriver.password}`
      );
      decryptedPassword = decrypt(updatedDriver.password);
    } catch (decryptError) {
      console.error(
        `Error decrypting password for driver: ${updatedDriver.driverName}`,
        decryptError
      );
    }

    const transformedDriver = {
      ...updatedDriver,
      password: decryptedPassword,
      registrationDate: formatDateToDDMMYYYY(
        new Date(updatedDriver.registrationDate)
      ),
    };

    console.log(
      "Updated driver data:",
      JSON.stringify(transformedDriver, null, 2)
    );
    res
      .status(200)
      .json({
        message: "Driver information updated successfully",
        driver: transformedDriver,
      });
  } catch (error) {
    console.error("Error updating driver:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
// DELETE METHOD
// Delete child
router.delete("/delete/child/:childId",branchAuthMiddleware,async (req, res) => {
    const { childId } = req.params;
    const { branchId } = req; // Assuming branchId is added to req by branchAuthMiddleware

    try {
      // Find the child by ID and check if they belong to the correct branch
      const child = await Child.findOne({ _id: childId, branchId }).lean();
      if (!child) {
        return res
          .status(404)
          .json({ error: "Child not found or does not belong to this branch" });
      }

      let parentData = {};
      if (child.parentId) {
        // Find the parent and ensure they belong to the same branch
        const parent = await Parent.findOne({
          _id: child.parentId,
          branchId,
        }).lean();
        if (parent) {
          parentData = {
            parentName: parent.parentName,
            email: parent.email,
            phone: parent.phone,
            parentId: parent._id,
          };

          // Check if the parent has any other children
          const childCount = await Child.countDocuments({
            parentId: child.parentId,
            branchId,
          });
          if (childCount === 1) {
            await Parent.findByIdAndDelete(child.parentId);
          }
        }
      }

      // Delete the child
      await Child.findByIdAndDelete(childId);

      console.log("Deleted child data:", JSON.stringify(child, null, 2));
      if (parentData.parentId) {
        console.log(
          "Associated parent data:",
          JSON.stringify(parentData, null, 2)
        );
      }

      res.status(200).json({
        message: "Child deleted successfully",
        child,
        parent: parentData,
      });
    } catch (error) {
      console.error("Error deleting child:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);
// DELETE METHOD
// Delete parent
router.delete("/delete-parent/:id", branchAuthMiddleware, async (req, res) => {
  const parentId = req.params.id;
  const { branchId } = req;

  try {
    // Find the parent by ID and ensure they belong to the correct branch
    const parent = await Parent.findOne({ _id: parentId, branchId }).lean();
    if (!parent) {
      return res
        .status(404)
        .json({ error: "Parent not found or does not belong to this branch" });
    }

    // Delete all children associated with the parent and ensure they belong to the same branch
    await Child.deleteMany({ _id: { $in: parent.children }, branchId });

    // Delete the parent
    await Parent.findByIdAndDelete(parentId);

    res
      .status(200)
      .json({ message: "Parent and associated children deleted successfully" });
  } catch (error) {
    console.error("Error deleting parent:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
// DELETE METHOD
// Delete driver
router.delete("/delete/driver/:id", branchAuthMiddleware, async (req, res) => {
  try {
    const { id: driverId } = req.params;
    const branchId = req.branchId; // Get the branchId from the middleware

    // Find and delete the driver by ID and branchId
    const deletedDriver = await DriverCollection.findOneAndDelete({
      _id: driverId,
      branchId,
    });

    if (!deletedDriver) {
      return res
        .status(404)
        .json({ error: "Driver not found or does not belong to your branch" });
    }

    console.log("Deleted driver data:", JSON.stringify(deletedDriver, null, 2));
    res.status(200).json({ message: "Driver deleted successfully" });
  } catch (error) {
    console.error("Error deleting driver:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
// DELETE METHOD
// Delete supervisor
router.delete("/delete/supervisor/:id",branchAuthMiddleware,async (req, res) => {
    try {
      const { id: supervisorId } = req.params;
      const branchId = req.branchId; // Get the branchId from the middleware

      // Find and delete the supervisor by ID and branchId
      const deletedSupervisor = await Supervisor.findOneAndDelete({
        _id: supervisorId,
        branchId,
      });

      if (!deletedSupervisor) {
        return res
          .status(404)
          .json({
            error: "Supervisor not found or does not belong to your branch",
          });
      }

      console.log(
        "Deleted supervisor data:",
        JSON.stringify(deletedSupervisor, null, 2)
      );
      res.status(200).json({ message: "Supervisor deleted successfully" });
    } catch (error) {
      console.error("Error deleting supervisor:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

module.exports = router;
