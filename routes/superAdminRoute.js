const express = require('express');
const router = express.Router();
const Superadmin = require('../models/superAdmin');
const School = require("../models/school");
const {superadminMiddleware,generateToken} = require('../jwt')
const Child = require("../models/child");
const Request = require("../models/request");
const Parent = require("../models/Parent");
const { decrypt } = require('../models/cryptoUtils');
const { formatDateToDDMMYYYY } = require('../utils/dateUtils');
const Supervisor = require("../models/supervisor");
const Branch = require('../models/branch');
const Attendance = require("../models/attendence");
const DriverCollection = require('../models/driver');
const jwt = require("jsonwebtoken");
const Geofencing = require("../models/geofence");
const Device = require('../models/device');
const { sendNotificationToParent } = require('../utils/notificationsUtils'); 

const axios = require('axios');
const BranchGroup = require('../models/branchgroup.model');
const moment = require('moment'); 



const convertDate = (dateStr) => {
  const dateParts = dateStr.split('-');
  const jsDate = new Date(`${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`);
  return {
    date: dateStr,
    originalDate: jsDate
  };
}



router.post('/register', async (req, res) => {
  try {
    const data = {
      username: req.body.username,
      email: req.body.email,
      password: req.body.password
    };
    const { email,username } = data;
    console.log("Received registration data:", data);

    const existingSuperadmin = await Superadmin.findOne({ $or: [{ email }, { username }] });
    if (existingSuperadmin) {
      console.log("Email or username  already exists");
      return res.status(400).json({ error: "Email or username already exists" });
    }

    const newSuperadmin = new Superadmin(data);
    const response = await newSuperadmin.save();
    console.log("Data saved:", response);

    const payload = { id: response.id, email: response.email };
    const token = generateToken(payload);

    res.status(201).json({ response: { ...response.toObject(), password: undefined }, token,role:"superadmin" }); 
  } catch (error) {
    console.error("Error during registration:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
router.post('/login',async (req, res) => {
  const { username, password } = req.body;
  try {
    const superadmin = await Superadmin.findOne({ username });
    if (!superadmin) {
      return res.status(400).json({ error: "Invalid username or password" });
    }
    const isMatch = await superadmin.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid username or password" });
    }
    const token = generateToken({ id: superadmin._id, username: superadmin.username });
    res.status(200).json({ success: true, message: "Login successful", token ,role: 'superadmin'});
  } catch (err) {
    console.error("Error during login:", err);
    res.status(500).json({ error: "Server error" });
  }
});
router.post('/school-register', superadminMiddleware, async (req, res) => {
  try {
    const { schoolName, username, password, email, schoolMobile, branchName } = req.body;

    // Check for existing school by username or email
    const existingSchool = await School.findOne({ $or: [{ username }, { email }] });
    if (existingSchool) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    // Create and save the new School
    const newSchool = new School({
      schoolName,
      username,
      password,
      email,
      schoolMobile
    });

    const savedSchool = await newSchool.save();

    // Create the initial Branch
    const newBranch = new Branch({
      branchName: branchName + "  main-branch",
      schoolId: savedSchool._id, 
      schoolMobile: '', 
      username: '', 
      password: '', 
      email: '' 
    });

    // Save the branch
    const savedBranch = await newBranch.save();

    // Update the School with the branch reference
    savedSchool.branches.push(savedBranch._id);
    await savedSchool.save();

    // Generate a token for the school
    const payload = { id: savedSchool._id, username: savedSchool.username };
    const token = generateToken(payload);

    res.status(201).json({ response: { ...savedSchool.toObject(), password: undefined }, token, role: "schooladmin" });
  } catch (error) {
    console.error('Error during registration:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.post('/add-branch', superadminMiddleware, async (req, res) => {
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
router.post('/migrate-schools', superadminMiddleware, async (req, res) => {
  try {
    // Find all schools
    const schools = await School.find({});

    for (const school of schools) {
      // Check if the main branch exists
      const mainBranch = await Branch.findOne({ 
        schoolId: school._id, 
        branchName: /main-branch/i 
      });

      if (mainBranch) {
        // Check if the main branch is already at the first position
        if (school.branches[0].toString() !== mainBranch._id.toString()) {
          // If not, move the main branch to the first position
          await School.findByIdAndUpdate(school._id, {
            $pull: { branches: mainBranch._id }, // Remove from current position
          });

          await School.findByIdAndUpdate(school._id, {
            $push: {
              branches: {
                $each: [mainBranch._id],
                $position: 0 // Add to the first position
              }
            }
          });
        }
      } else {
        // If the main branch doesn't exist, create it
        const newBranch = new Branch({
          branchName: school.schoolName + ' main-branch',
          schoolId: school._id,
          schoolMobile: '',
          username: '',
          password: '',
          email: ''
        });

        const savedBranch = await newBranch.save();

        // Add the new main branch to the first position
        await School.findByIdAndUpdate(school._id, {
          $push: {
            branches: {
              $each: [{ _id: savedBranch._id, branchName: savedBranch.branchName }],
              $position: 0
            }
          }
        });

        school.branchName = savedBranch.branchName;
        await school.save();
      }
    }

    res.status(200).json({ message: 'Migration completed successfully' });
  } catch (error) {
    console.error('Error during migration:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// router.get('/getschools', superadminMiddleware, async (req, res) => {
//   try {
//     const schools = await School.find({})
//       .populate({
//         path: 'branches',
//         select: 'branchName _id username password email',
//         populate: {
//           path: 'devices',
//           select: 'deviceId deviceName'
//         }
//       })
//       .lean();

//     const transformedSchools = await Promise.all(schools.map(async (school) => {
//       let decryptedSchoolPassword;
//       try {
//         decryptedSchoolPassword = school.password ? decrypt(school.password) : 'No password';
//       } catch (decryptError) {
//         console.error(`Error decrypting password for school ${school.schoolName}`, decryptError);
//         decryptedSchoolPassword = 'Error decrypting password';
//       }
      
//       const transformedBranches = school.branches.map(branch => {
//         let decryptedBranchPassword;
//         try {
//           decryptedBranchPassword = branch.password ? decrypt(branch.password) : 'No password'; 
//         } catch (decryptError) {
//           console.error(`Error decrypting password for branch ${branch.branchName}`, decryptError);
//           decryptedBranchPassword = 'Error decrypting password'; 
//         }

//         // Check if the branch is the main branch and add school fields
//         const isMainBranch = branch.branchName.toLowerCase().includes("main-branch");
//         return {
//           ...branch,
//           password: isMainBranch ? decryptedSchoolPassword : decryptedBranchPassword,
//           username: isMainBranch ? school.username : branch.username,
//           email: isMainBranch ? school.email : branch.email, // Set email to school email for main branch
//           schoolMobile: isMainBranch ? school.schoolMobile : branch.schoolMobile,
//           devices: branch.devices // Include devices
//         };
//       });

//       // Get the main branch name for the outer field
//       const mainBranchName = transformedBranches.find(branch => 
//         branch.branchName.toLowerCase().includes("main-branch")
//       )?.branchName || null;

//       // Return the transformed school object
//       return {
//         ...school,
//         password: decryptedSchoolPassword,
//         branchName: mainBranchName, // Include the main branch name
//         branches: transformedBranches
//       };
//     }));
    
//     res.status(200).json({ schools: transformedSchools });
//   } catch (error) {
//     console.error('Error fetching school list:', error);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// });
router.get('/getschools', superadminMiddleware, async (req, res) => {
  try {
    const schools = await School.find({})
      .populate({
        path: 'branches',
        select: 'branchName _id username password email schoolMobile',
        populate: {
          path: 'devices',
          select: 'deviceId deviceName'
        }
      })
      .lean();

    const transformedSchools = await Promise.all(schools.map(async (school) => {
      let decryptedSchoolPassword;
      try {
        decryptedSchoolPassword = school.password ? decrypt(school.password) : 'No password';
      } catch (decryptError) {
        console.error(`Error decrypting password for school ${school.schoolName}`, decryptError);
        decryptedSchoolPassword = 'Error decrypting password';
      }
      
      const transformedBranches = school.branches.map(branch => {
        let decryptedBranchPassword;
        try {
          decryptedBranchPassword = branch.password ? decrypt(branch.password) : 'No password'; 
        } catch (decryptError) {
          console.error(`Error decrypting password for branch ${branch.branchName}`, decryptError);
          decryptedBranchPassword = 'Error decrypting password'; 
        }

        // Check if the branch is the main branch and add school fields
        const isMainBranch = branch.branchName.toLowerCase().includes("main-branch");
        return {
          ...branch,
          password: isMainBranch ? decryptedSchoolPassword : decryptedBranchPassword,
          username: isMainBranch ? school.username : branch.username,
          email: isMainBranch ? school.email : branch.email, // Set email to school email for main branch
          schoolMobile: isMainBranch ? school.schoolMobile : branch.schoolMobile,
          devices: branch.devices // Include devices
        };
      });

      // Get the main branch name for the outer field
      const mainBranchName = transformedBranches.find(branch => 
        branch.branchName.toLowerCase().includes("main-branch")
      )?.branchName || null;

      // Explicitly set fullAccess to false if it's missing
      const fullAccessValue = school.fullAccess === undefined ? false : school.fullAccess;

      // Return the transformed school object
      return {
        ...school,
        password: decryptedSchoolPassword,
        branchName: mainBranchName, // Include the main branch name
        branches: transformedBranches,
        fullAccess: fullAccessValue // Show default false if no action is performed
      };
    }));
    
    res.status(200).json({ schools: transformedSchools });
  } catch (error) {
    console.error('Error fetching school list:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.get('/read-devices', superadminMiddleware, async (req, res) => {
  try {
    // Fetch all schools
    const schools = await School.find({}).lean();

    // Prepare an array to hold data grouped by school
    const dataBySchool = await Promise.all(
      schools.map(async (school) => {
        const schoolId = school._id;
        const schoolName = school.schoolName;

        // Fetch all branches for the current school
        const branches = await Branch.find({ schoolId: schoolId }).lean();

        // Fetch devices and format the data
        const devicesByBranch = await Promise.all(
          branches.map(async (branch) => {
            const branchId = branch._id;
            const branchName = branch.branchName;

            // Fetch devices associated with the current branch
            const devices = await Device.find({ schoolId: schoolId, branchId: branchId }).lean();

            // Map over devices and return the relevant details
            const rawDevices = devices.map((device) => ({
              actualDeviceId: device._id, // MongoDB's _id for edit/delete operations
              deviceId: device.deviceId,   // Schema deviceId for display
              deviceName: device.deviceName, // Device name as stored in the schema
              registrationDate: device.registrationDate,
            }));

            // Return data grouped by branch
            return {
              branchId: branchId,
              branchName: branchName,
              devices: rawDevices,
            };
          })
        );

        // Return data grouped by school
        return {
          schoolId: schoolId,
          schoolName: schoolName,
          branches: devicesByBranch,
        };
      })
    );

    // Send response in the desired structure
    res.status(200).json({
      data: dataBySchool,
    });
  } catch (error) {
    console.error('Error fetching devices by school:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.get('/read-children', superadminMiddleware, async (req, res) => {
  try {
    // Fetch all schools
    const schools = await School.find({}).lean();

    // Prepare an array to hold children data by school
    const childrenBySchool = await Promise.all(schools.map(async (school) => {
      // Fetch all branch data for this school
      const branches = await Branch.find({ schoolId: school._id }).lean();

      // Fetch children and populate parent data
      const children = await Child.find({ schoolId: school._id })
        .populate('parentId', 'parentName email phone password statusOfRegister')
        .lean();

      // Format children data by branch
      const childrenByBranch = await Promise.all(branches.map(async (branch) => {
        const childrenInBranch = await Promise.all(children
          .filter(child => child.branchId?.toString() === branch._id.toString())
          .map(async (child) => {
            // Decrypt parent password
            const parent = await Parent.findById(child.parentId._id).lean();
            const password = parent ? decrypt(parent.password) : '';

            return {
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
              password, 
              statusOfRegister: child.parentId.statusOfRegister,
              deviceId: child.deviceId,
              registrationDate: child.registrationDate,
              formattedRegistrationDate: formatDateToDDMMYYYY(new Date(child.registrationDate)),
            };
          })
        );

        return {
          branchId: branch._id,
          branchName: branch.branchName,
          children: childrenInBranch,
        };
      }));

      return {
        schoolId: school._id,
        schoolName: school.schoolName,
        branches: childrenByBranch,
      };
    }));

    res.status(200).json({
      data: childrenBySchool,
    });
  } catch (error) {
    console.error('Error fetching children by school:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.get('/read-parents', superadminMiddleware, async (req, res) => {
  try {
    // Fetch all schools
    const schools = await School.find({}).lean();

    // Initialize an empty array to hold schools data
    const schoolsData = [];

    // Iterate over each school to fetch branches and parents
    await Promise.all(schools.map(async (school) => {
      const schoolId = school._id;
      const schoolName = school.schoolName;

      // Fetch branches for the current school
      const branches = await Branch.find({ schoolId }).lean();

      // Initialize an array to hold branch data
      const branchesData = [];

      // Iterate over each branch to fetch parents and children
      await Promise.all(branches.map(async (branch) => {
        const branchId = branch._id;
        const branchName = branch.branchName;

        // Fetch parents for the current branch
        const parents = await Parent.find({ schoolId, branchId })
          .populate('children', '_id childName registrationDate') // Populate childName and registrationDate
          .lean();

        // Transform and aggregate parent data
        const transformedParents = await Promise.all(parents.map(async (parent) => {
          let decryptedPassword;
          try {
            decryptedPassword = decrypt(parent.password); // Decrypt the password
          } catch (decryptError) {
            console.error(`Error decrypting password for parent ${parent.parentName}`, decryptError);
            decryptedPassword = null;
          }

          // Transform children data with formatted registration date
          const transformedChildren = parent.children.map(child => ({
            childId: child._id,
            childName: child.childName,
            registrationDate: formatDateToDDMMYYYY(new Date(child.registrationDate)),
          }));

          return {
            parentId: parent._id,
            parentName: parent.parentName,
            email: parent.email,
            phone: parent.phone,
            password: decryptedPassword, // Decrypted password
            registrationDate: formatDateToDDMMYYYY(new Date(parent.parentRegistrationDate)), // Format parent's registration date
            statusOfRegister: parent.statusOfRegister, // Status of parent registration
            children: transformedChildren,
          };
        }));

        // Add the branch data to the branchesData array
        branchesData.push({
          branchId: branchId,
          branchName: branchName,
          parents: transformedParents
        });
      }));

      // Add the school data to the schoolsData array
      schoolsData.push({
        schoolId: schoolId,
        schoolName: schoolName,
        branches: branchesData
      });
    }));

    // Send the response
    res.status(200).json({
      data: schoolsData
    });
  } catch (error) {
    console.error('Error fetching all parents:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.get('/pending-requests', superadminMiddleware, async (req, res) => {
  try {
    // Fetch all schools
    const schools = await School.find({}).lean();

    // Initialize an empty array to hold requests data by school and branch
    const requestsBySchool = await Promise.all(schools.map(async (school) => {
      const schoolId = school._id;
      const schoolName = school.schoolName;

      // Fetch all branches for the current school
      const branches = await Branch.find({ schoolId: schoolId }).lean();
      
      // Initialize an array to hold the requests grouped by branch
      const requestsByBranch = await Promise.all(branches.map(async (branch) => {
        const branchId = branch._id;
        const branchName = branch.branchName;

        // Fetch pending requests for the current branch
        const requests = await Request.find({
          statusOfRequest: "pending",
          schoolId: schoolId,
          branchId: branchId
        })
          .populate({
            path: "childId",
            select: "childName class deviceId",
          })
          .populate("parentId", "parentName email phone")
          .lean();

        // Filter out requests where the parent or child does not exist
        const validRequests = requests.filter(
          (request) => request.parentId && request.childId
        );

        // Format the request data
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
            deviceId: request.childId.deviceId,
            deviceName: request.childId.deviceName,
            requestDate: request.requestDate
              ? formatDateToDDMMYYYY(new Date(request.requestDate))
              : null,
            schoolName: schoolName,
            branchName: branchName
          };

          // Add fields conditionally based on the request type
          if (request.requestType === "leave") {
            formattedRequest.startDate = request.startDate
              ? formatDateToDDMMYYYY(new Date(request.startDate))
              : null;
            formattedRequest.endDate = request.endDate
              ? formatDateToDDMMYYYY(new Date(request.endDate))
              : null;
          } else if (request.requestType === "changeRoute") {
            formattedRequest.newRoute = request.newRoute || null;
          }

          return formattedRequest;
        });

        return {
          branchId: branchId,
          branchName: branchName,
          requests: formattedRequests,
        };
      }));

      // Return school data with requests grouped by branch
      return {
        schoolId: schoolId,
        schoolName: schoolName,
        branches: requestsByBranch,
      };
    }));

    // Send the response
    res.status(200).json({
      data: requestsBySchool,
    });
  } catch (error) {
    console.error("Error fetching pending requests:", error);
    res.status(500).json({
      error: "Internal server error",
    });
  }
});
router.get('/approved-requests', superadminMiddleware, async (req, res) => {
  try {
    // Fetch all schools
    const schools = await School.find({}).lean();

    // Initialize an empty array to hold requests data by school and branch
    const approvedRequestsBySchool = await Promise.all(schools.map(async (school) => {
      const schoolId = school._id;
      const schoolName = school.schoolName;

      // Fetch all branches for the current school
      const branches = await Branch.find({ schoolId: schoolId }).lean();
      
      // Initialize an array to hold the requests grouped by branch
      const requestsByBranch = await Promise.all(branches.map(async (branch) => {
        const branchId = branch._id;
        const branchName = branch.branchName;

        // Fetch approved requests for the current branch
        const requests = await Request.find({
          statusOfRequest: "approved",
          schoolId: schoolId,
          branchId: branchId
        })
          .populate({
            path: "childId",
            select: "childName class deviceId",
          })
          .populate("parentId", "parentName email phone")
          .lean();

        // Filter out requests where the parent or child does not exist
        const validRequests = requests.filter(
          (request) => request.parentId && request.childId
        );

        // Format the request data
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
            deviceId: request.childId.deviceId,
            deviceName:request.childId.deviceName,
            requestDate: request.requestDate
              ? formatDateToDDMMYYYY(new Date(request.requestDate))
              : null,
            // Add schoolName and branchName to each request
            schoolName: schoolName,
            branchName: branchName
          };

          // Add fields conditionally based on the request type
          if (request.requestType === "leave") {
            formattedRequest.startDate = request.startDate || null;
            formattedRequest.endDate = request.endDate || null;
          } else if (request.requestType === "changeRoute") {
            formattedRequest.newRoute = request.newRoute || null;
          }

          return formattedRequest;
        });

        return {
          branchId: branchId,
          branchName: branchName,
          requests: formattedRequests,
        };
      }));

      // Return school data with requests grouped by branch
      return {
        schoolId: schoolId,
        schoolName: schoolName,
        branches: requestsByBranch,
      };
    }));

    // Send the response
    res.status(200).json({
      data: approvedRequestsBySchool,
    });
  } catch (error) {
    console.error("Error fetching approved requests:", error);
    res.status(500).json({
      error: "Internal server error",
    });
  }
});
router.get('/denied-requests', superadminMiddleware, async (req, res) => {
  try {
    // Fetch all schools
    const schools = await School.find({}).lean();

    // Initialize an empty array to hold requests data by school and branch
    const deniedRequestsBySchool = await Promise.all(schools.map(async (school) => {
      const schoolId = school._id;
      const schoolName = school.schoolName;

      // Fetch all branches for the current school
      const branches = await Branch.find({ schoolId }).lean();
      
      // Initialize an array to hold the denied requests grouped by branch
      const requestsByBranch = await Promise.all(branches.map(async (branch) => {
        const branchId = branch._id;
        const branchName = branch.branchName;

        // Fetch denied requests for the current branch
        const deniedRequests = await Request.find({
          statusOfRequest: 'denied',
          schoolId: schoolId,
          branchId: branchId
        })
        .populate("parentId", "parentName email phone")
        .populate("childId", "childName deviceId class branchId")
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
          deviceName: request.childId.deviceName,
          class: request.childId.class,
          statusOfRequest: request.statusOfRequest,
          parentName: request.parentId.parentName,
          email: request.parentId.email,
          phone: request.parentId.phone,
          schoolName: schoolName,
          branchName: branchName,
          requestDate: request.requestDate,
          formattedRequestDate: request.requestDate
            ? formatDateToDDMMYYYY(new Date(request.requestDate))
            : null,
        }));

        return {
          branchId: branchId,
          branchName: branchName,
          requests: formattedRequests,
        };
      }));

      // Return school data with requests grouped by branch
      return {
        schoolId: schoolId,
        schoolName: schoolName,
        branches: requestsByBranch,
      };
    }));

    // Send the response
    res.status(200).json({
      data: deniedRequestsBySchool,
    });
  } catch (error) {
    console.error('Error fetching denied requests:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.get('/read-drivers', superadminMiddleware, async (req, res) => {
  try {
    // Fetch all schools
    const schools = await School.find({}).lean();

    // Prepare an array to hold drivers data by school
    const driversBySchool = await Promise.all(schools.map(async (school) => {
      // Fetch all branches for the current school
      const branches = await Branch.find({ schoolId: school._id }).lean();

      // Fetch drivers and format the data
      const driversByBranch = await Promise.all(
        branches.map(async (branch) => {
          // Fetch drivers associated with the current branch
          const drivers = await DriverCollection.find({
            schoolId: school._id,
            branchId: branch._id,
          })
            .populate('schoolId', 'schoolName')
            .populate('branchId', 'branchName')
            .lean();

          // Format driver data
          const formattedDrivers = drivers.map((driver) => {
            let decryptedPassword;
            try {
              decryptedPassword = decrypt(driver.password);
            } catch (decryptError) {
              decryptedPassword = 'Error decrypting password';
            }

            return {
              driverId: driver._id,
              driverName: driver.driverName,
              address: driver.address,
              driverMobile: driver.driverMobile,
              email: driver.email,
              deviceName: driver.deviceName,
              deviceId: driver.deviceId,
              statusOfRegister:driver.statusOfRegister,
              schoolName: driver.schoolId ? driver.schoolId.schoolName : 'N/A', // Access the populated schoolName
              branchName: driver.branchId ? driver.branchId.branchName : 'Branch not found', // Include branchName
              registrationDate: driver.registrationDate,
              formattedRegistrationDate: formatDateToDDMMYYYY(new Date(driver.registrationDate)),
              password: decryptedPassword, // Include decrypted password
            };
          });

          // Return data grouped by branch
          return {
            branchId: branch._id,
            branchName: branch.branchName,
            drivers: formattedDrivers,
          };
        })
      );

      // Return data grouped by school
      return {
        schoolId: school._id,
        schoolName: school.schoolName,
        branches: driversByBranch,
      };
    }));

    // Send response
    res.status(200).json({
      data: driversBySchool,
    });
  } catch (error) {
    console.error('Error fetching drivers by school:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.get('/read-supervisors', superadminMiddleware, async (req, res) => {
  try {
    // Fetch all schools
    const schools = await School.find({}).lean();

    // Prepare an array to hold supervisors data by school
    const supervisorsBySchool = await Promise.all(
      schools.map(async (school) => {
        const schoolId = school._id;
        const schoolName = school.schoolName;

        // Fetch all branches for the current school
        const branches = await Branch.find({ schoolId: schoolId }).lean();

        // Fetch supervisors and format the data
        const supervisorsByBranch = await Promise.all(
          branches.map(async (branch) => {
            const branchId = branch._id;
            const branchName = branch.branchName;

            // Fetch supervisors associated with the current branch
            const supervisors = await Supervisor.find({
              schoolId: schoolId,
              branchId: branchId,
            })
              .populate('schoolId', 'schoolName')
              .populate('branchId', 'branchName')
              .lean();

            // Format supervisor data
            const formattedSupervisors = supervisors.map((supervisor) => {
              let decryptedPassword;
              try {
                decryptedPassword = decrypt(supervisor.password);
              } catch (decryptError) {
                decryptedPassword = 'Error decrypting password';
              }

              return {
                supervisorId: supervisor._id,
                supervisorName: supervisor.supervisorName,
                address: supervisor.address,
                phone_no: supervisor.phone_no,
                email: supervisor.email,
                deviceId: supervisor.deviceId,
                statusOfRegister:supervisor.statusOfRegister,
                deviceName:supervisor.deviceName,
                schoolName: supervisor.schoolId ? supervisor.schoolId.schoolName : 'N/A', // Access the populated schoolName
                branchName: supervisor.branchId ? supervisor.branchId.branchName : 'Branch not found', // Include branchName
                registrationDate: supervisor.registrationDate,
                formattedRegistrationDate: formatDateToDDMMYYYY(new Date(supervisor.registrationDate)),
                password: decryptedPassword, // Include decrypted password
              };
            });

            // Return data grouped by branch
            return {
              branchId: branchId,
              branchName: branchName,
              supervisors: formattedSupervisors,
            };
          })
        );

        // Return data grouped by school
        return {
          schoolId: schoolId,
          schoolName: schoolName,
          branches: supervisorsByBranch,
        };
      })
    );

    // Send response in the desired structure
    res.status(200).json({
      data: supervisorsBySchool,
    });
  } catch (error) {
    console.error('Error fetching supervisors by school:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.get("/pickup-drop-status",superadminMiddleware, async (req, res) => {
  try {
    const schools = await School.find({}).lean();

    const dataBySchool = await Promise.all(
      schools.map(async (school) => {
        const schoolId = school._id.toString();
        const schoolName = school.schoolName;

        const branches = await Branch.find({ schoolId }).lean();

        const dataByBranch = await Promise.all(
          branches.map(async (branch) => {
            const branchId = branch._id.toString();
            const branchName = branch.branchName;

            const attendanceRecords = await Attendance.find({ schoolId, branchId })
              .populate({
                path: "childId",
                match: { schoolId, branchId },
                populate: [
                  { path: "parentId", select: "phone name email" },
                  { path: "branchId", select: "branchName" },
                  { path: "schoolId", select: "schoolName" },
                ],
              })
              .lean();

            const childrenData = attendanceRecords
              .filter(record => record.childId && record.childId.parentId).map(record => {
                return {
                  childId: record.childId._id.toString(),
                  childName: record.childId.childName,
                  class: record.childId.class,
                  rollno: record.childId.rollno,
                  section: record.childId.section,
                  dateOfBirth: record.childId.dateOfBirth,
                  childAge: record.childId.childAge,
                  pickupPoint: record.childId.pickupPoint,
                  deviceName: record.childId.deviceName,
                  gender: record.childId.gender,
                  parentId: record.childId.parentId._id.toString(),
                  parentName: record.childId.parentId.name,
                  email: record.childId.parentId.email,
                  phone: record.childId.parentId.phone,
                  statusOfRegister: record.childId.statusOfRegister,
                  deviceId: record.childId.deviceId,
                  date:record.date,
                  pickupStatus: record.pickup,
                  pickupTime: record.pickupTime,
                  dropStatus: record.drop,
                  dropTime: record.dropTime,
                };
              });

            return {
              branchId: branchId,
              branchName: branchName,
              children: childrenData,
            };
          })
        );

        return {
          schoolId: schoolId,
          schoolName: schoolName,
          branches: dataByBranch,
        };
      })
    );

    res.status(200).json({ data: dataBySchool });
  } catch (error) {
    console.error("Error fetching attendance data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
router.get("/present-children", superadminMiddleware, async (req, res) => {
  try {
    const schools = await School.find({}).lean();

    const dataBySchool = await Promise.all(
      schools.map(async (school) => {
        const schoolId = school._id.toString();
        const schoolName = school.schoolName;

        const branches = await Branch.find({ schoolId }).lean();

        const dataByBranch = await Promise.all(
          branches.map(async (branch) => {
            const branchId = branch._id.toString();
            const branchName = branch.branchName;

            const attendanceRecords = await Attendance.find({ schoolId, branchId, pickup: true })
              .populate({
                path: "childId",
                match: { schoolId, branchId },
                populate: [
                  { path: "parentId", select: "phone name email" },
                  { path: "branchId", select: "branchName" },
                  { path: "schoolId", select: "schoolName" },
                ],
              })
              .lean();

            const childrenData = attendanceRecords
              .filter(record => record.childId && record.childId.parentId)
              .map(record => {
                const { date, originalDate } = convertDate(record.date);

                return {
                  childId: record.childId._id.toString(),
                  childName: record.childId.childName,
                  class: record.childId.class,
                  rollno: record.childId.rollno,
                  section: record.childId.section,
                  dateOfBirth: record.childId.dateOfBirth,
                  childAge: record.childId.childAge,
                  pickupPoint: record.childId.pickupPoint,
                  deviceName: record.childId.deviceName,
                  gender: record.childId.gender,
                  parentId: record.childId.parentId._id.toString(),
                  parentName: record.childId.parentId.name,
                  email: record.childId.parentId.email,
                  phone: record.childId.parentId.phone,
                  statusOfRegister: record.childId.statusOfRegister,
                  deviceId: record.childId.deviceId,
                  date:record.date,
                  pickupStatus: record.pickup,
                  pickupTime: record.pickupTime,
                };
              });

            return {
              branchId: branchId,
              branchName: branchName,
              children: childrenData,
            };
          })
        );

        return {
          schoolId: schoolId,
          schoolName: schoolName,
          branches: dataByBranch,
        };
      })
    );

    res.status(200).json({ data: dataBySchool });
  } catch (error) {
    console.error("Error fetching present pickup data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
router.get("/absent-children", superadminMiddleware, async (req, res) => {
  try {
    // Fetch all schools
    const schools = await School.find({}).lean();

    // Fetch attendance records for children absent at pickup by school
    const dataBySchool = await Promise.all(schools.map(async (school) => {
      const schoolId = school._id.toString();
      const schoolName = school.schoolName;

      // Fetch branches for the current school
      const branches = await Branch.find({ schoolId }).lean();

      const dataByBranch = await Promise.all(branches.map(async (branch) => {
        const branchId = branch._id.toString();
        const branchName = branch.branchName;

        // Fetch attendance records for the current branch where pickup is false
        const attendanceRecords = await Attendance.find({
          schoolId,
          branchId,
          pickup: false
        })
          .populate({
            path: "childId",
            match: { schoolId, branchId },
            populate: [
              { path: "parentId", select: "phone" }, // Populate parentId to get parent's phone
              { path: "branchId", select: "branchName" }, // Populate branchId to get the branch name
              { path: "schoolId", select: "schoolName" } // Populate schoolId to get the school name
            ]
          })
          .lean(); // Use lean() to get plain JavaScript objects

        // Filter and map the data for the response
        const childrenData = attendanceRecords
          .filter(record => record.childId && record.childId.parentId)
          .map(record => {
            const { date, originalDate } = convertDate(record.date);

            return {
              _id: record.childId._id.toString(),
              childName: record.childId.childName,
              class: record.childId.class,
              rollno: record.childId.rollno,
              section: record.childId.section,
              parentId: record.childId.parentId._id.toString(),
              phone: record.childId.parentId.phone,
              branchName: record.childId.branchId ? record.childId.branchId.branchName : "Branch not found", // Include branch name
              schoolName: record.childId.schoolId ? record.childId.schoolId.schoolName : "School not found", // Include school name
              pickupStatus: record.pickup,
              pickupTime: record.pickupTime,
              deviceId: record.childId.deviceId,
              deviceName: record.childId.deviceName,
              pickupPoint: record.childId.pickupPoint,
              date:record.date
            };
          });

        return {
          branchId: branchId,
          branchName: branchName,
          children: childrenData
        };
      }));

      return {
        schoolId: schoolId,
        schoolName: schoolName,
        branches: dataByBranch
      };
    }));

    // Send the formatted data by school
    res.status(200).json({ data: dataBySchool });

  } catch (error) {
    console.error("Error fetching absent children data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
router.get('/status-of-children', superadminMiddleware, async (req, res) => {
  try {
    const children = await Child.find({})
      .populate('parentId')
      .populate('schoolId')
      .populate({
        path: 'branchId',
        select: 'branchName'
      })
      .lean();

    if (!children || children.length === 0) {
      return res.status(404).json({ message: 'No children found in any school or branch' });
    }

    const schoolBranchData = {};

    for (const child of children) {
      const school = child.schoolId;
      const branch = child.branchId;
      const parent = child.parentId;
      const password = parent ? decrypt(parent.password) : 'Unknown Password';

      const attendance = await Attendance.findOne({ childId: child._id })
        .sort({ date: -1 })
        .limit(1)
        .lean();

      const request = await Request.findOne({ childId: child._id })
        .sort({ requestDate: -1 })
        .limit(1)
        .lean();

      let supervisor = null;
      if (child.deviceId) {
        supervisor = await Supervisor.findOne({ deviceId: child.deviceId }).lean();
      }

      if (attendance || request) {
        const childData = {
          childId: child._id,
          childName: child.childName,
          childClass: child.class,
          childAge: child.childAge,
          section: child.section,
          rollno: child.rollno,
          deviceId: child.deviceId,
          deviceName:child.deviceName,
          gender: child.gender,
          pickupPoint: child.pickupPoint,
          parentName: parent ? parent.parentName : 'Unknown Parent',
          parentNumber: parent ? parent.phone : 'Unknown Phone',
          email: parent ? parent.email : 'Unknown email',
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
            startDate: request.startDate ? formatDateToDDMMYYYY(request.startDate) : 'N/A',
            endDate: request.endDate ? formatDateToDDMMYYYY(request.endDate) : 'N/A',
            reason: request.reason,
            newRoute: request.newRoute,
            statusOfRequest: request.statusOfRequest,
            requestDate: request.requestDate ? formatDateToDDMMYYYY(request.requestDate) : 'N/A'
          }),
          ...(supervisor && {
            supervisorName: supervisor.supervisorName
          })
        };

        if (!schoolBranchData[school._id]) {
          schoolBranchData[school._id] = {
            schoolId: school._id.toString(),
            schoolName: school.schoolName,
            branches: {}
          };
        }

        if (!schoolBranchData[school._id].branches[branch._id]) {
          schoolBranchData[school._id].branches[branch._id] = {
            branchId: branch._id.toString(),
            branchName: branch.branchName,
            children: []
          };
        }

        schoolBranchData[school._id].branches[branch._id].children.push(childData);
      }
    }

    const responseData = Object.values(schoolBranchData).map(school => ({
      schoolId: school.schoolId,
      schoolName: school.schoolName,
      branches: Object.values(school.branches).map(branch => ({
        branchId: branch.branchId,
        branchName: branch.branchName,
        children: branch.children
      }))
    }));

    res.json({ data: responseData });
  } catch (error) {
    console.error('Error fetching children status:', error);
    res.status(500).json({ message: 'Server error' });
  }
});
router.get('/status/:childId', superadminMiddleware, async (req, res) => {
  try {
    const { childId } = req.params;

    // Find the child and populate branch, parent, and school details
    const child = await Child.findOne({ _id: childId })
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
    const branch = child.branchId;
    const school = child.schoolId;
    const password = parent && parent.password ? decrypt(parent.password) : 'Unknown Password';
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
      supervisor = await Supervisor.findOne({ deviceId: child.deviceId, schoolId: child.schoolId });
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
    if (parent && parent.parentName) response.parentName = parent.parentName;
    if (parent && parent.phone) response.parentNumber = parent.phone;
    if (parent && parent.email) response.email = parent.email;
    if (password) response.password = password; 
    if (branch && branch.branchName) response.branchName = branch.branchName;
    if (school && school.schoolName) response.schoolName = school.schoolName;
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
router.get('/geofences', async (req, res) => {
  try {
    // Fetch all geofences with only deviceId and area
    const geofences = await Geofencing.find().select('deviceId area name isCrossed busStopTime');

    // Fetch all devices with populated schoolId, branchId, and deviceName
    const devices = await Device.find() // Removed .select() here to ensure all fields are fetched
      .populate('schoolId', 'schoolName') // Populate only the schoolName
      .populate('branchId', 'branchName'); // Populate only the branchName

    // Create a map of deviceId to school, branch, and device names
    const deviceMap = {};
    devices.forEach(device => {
      deviceMap[device.deviceId] = {
        schoolName: device.schoolId ? device.schoolId.schoolName : 'Unknown School',
        branchName: device.branchId ? device.branchId.branchName : 'Unknown Branch',
        deviceName: device.deviceName || 'Unknown Device', // Add deviceName
      };
    });

    // Create a grouped response
    const response = {};
    
    geofences.forEach(geofence => {
      const deviceId = geofence.deviceId; // Directly use deviceId
      
      // Initialize the deviceId key in the response if it doesn't exist
      if (!response[`deviceId: ${deviceId}`]) {
        response[`deviceId: ${deviceId}`] = [];
      }

      // Push the geofence data along with school, branch, and device names
      response[`deviceId: ${deviceId}`].push({
        _id: geofence._id,
        name: geofence.name,
        area: geofence.area,
        busStopTime: geofence.busStopTime,
        isCrossed: geofence.isCrossed,
        deviceId: deviceId,
        schoolName: deviceMap[deviceId]?.schoolName || 'Unknown School',
        branchName: deviceMap[deviceId]?.branchName || 'Unknown Branch',
        deviceName: deviceMap[deviceId]?.deviceName || 'Unknown Device', // Add deviceName to the response
        __v: geofence.__v // Ensure to include __v if needed
      });
    });

    // Respond with the structured response
    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({ message: 'Error retrieving geofences', error });
  }
});



// POST METHOD
router.post("/review-request/:requestId", superadminMiddleware, async (req, res) => {
  try {
    const { statusOfRequest } = req.body;
    const { requestId } = req.params;

    if (!["approved", "denied"].includes(statusOfRequest)) {
      return res.status(400).json({ error: "Invalid statusOfRequest" });
    }

    const request = await Request.findById(requestId);
    if (!request) {
      return res.status(404).json({ error: "Request not found" });
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

    // Fetch parent info and send notification
    const parent = await Parent.findById(request.parentId);
    if (parent && parent.fcmToken) {
      const notificationMessage = `Your request has been ${statusOfRequest}.`;

      // Use the same notification logic from markPickup to send notification
      await sendNotificationToParent(parent.fcmToken, "Request Status", notificationMessage);
    }

    res.status(200).json({
      message: `Request reviewed successfully.`,
      request: request.toObject(),
    });
  } catch (error) {
    console.error("Error reviewing request:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
router.post('/registerStatus/:parentId', superadminMiddleware, async (req, res) => {
  try {
    const { parentId } = req.params;
    const { action } = req.body;

    // Find the parent by ID
    const parent = await Parent.findById(parentId);
    if (!parent) {
      return res.status(404).json({ error: 'Parent not found' });
    }

    // Prevent updating the status if it's already been set to approved or rejected
    if (parent.statusOfRegister === 'approved' || parent.statusOfRegister === 'rejected') {
      return res.status(400).json({ error: 'Registration status has already been set and cannot be changed.' });
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
router.post('/registerStatus-driver/:driverId', superadminMiddleware, async (req, res) => {
  try {
    const { driverId } = req.params;
    const { action } = req.body;

    // Find the driver by ID
    const driver = await DriverCollection.findById(driverId);
    if (!driver) {
      return res.status(404).json({ error: 'driver not found' });
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
router.post('/registerStatus-supervisor/:supervisorId', superadminMiddleware, async (req, res) => {
  try {
    const { supervisorId } = req.params;
    const { action } = req.body;

    // Find the supervisor by ID
    const supervisor = await Supervisor.findById(supervisorId);
    if (!supervisor) {
      return res.status(404).json({ error: 'supervisor not found' });
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

router.post('/add-device', superadminMiddleware, async (req, res) => {
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



// EDIT METHOD
router.put('/edit-device/:actualDeviceId', superadminMiddleware, async (req, res) => {
  try {
    const { actualDeviceId } = req.params; // The MongoDB _id of the device from the URL
    const { deviceId, deviceName, branchName, schoolName } = req.body; // The new values from the request body

    // Validate that required fields are provided
    if (!deviceId || !deviceName || !branchName || !schoolName) {
      return res.status(400).json({ message: 'deviceId, deviceName, branchName, and schoolName are required' });
    }

    // Check if the manually added deviceId already exists in another device
    const existingDevice = await Device.findOne({
      deviceId,
      _id: { $ne: actualDeviceId } // Exclude the current device from this check
    });

    if (existingDevice) {
      return res.status(400).json({ message: 'Device with this manually added deviceId already exists' });
    }

    // Find and update the device
    const updatedDevice = await Device.findByIdAndUpdate(
      actualDeviceId,
      {
        deviceId, // Manually added deviceId
        deviceName,
        branchName, // Manually provided branch name
        schoolName  // Manually provided school name
      },
      { new: true } // Return the updated document
    );

    if (!updatedDevice) {
      return res.status(404).json({ message: 'Device not found' });
    }

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
    if (!branch.devices.includes(updatedDevice._id)) {
      branch.devices.push(updatedDevice._id);
      await branch.save();
    }

    // Return success response with the updated device data
    res.status(200).json({ message: 'Device updated successfully', device: updatedDevice });
  } catch (error) {
    console.error('Error updating device:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});
router.put('/update-child/:childId', superadminMiddleware, async (req, res) => {
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
        if (password) {
          parent.password = password; 
        }

        await parent.save(); 
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
router.put('/update-parent/:id', superadminMiddleware, async (req, res) => {
  const parentId = req.params.id;
  const { parentName, email, password, phone } = req.body;

  try {
    // Find the parent by ID
    const parent = await Parent.findById(parentId);
    
    if (!parent) {
      return res.status(404).json({ error: 'Parent not found' });
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
router.put('/edit-school/:id', superadminMiddleware, async (req, res) => {
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

    // Find the school by ID
    const school = await School.findById(id);
    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }

    // Update the fields
    school.schoolName = schoolName || school.schoolName;
    school.username = username || school.username;
    school.email = email || school.email;
    school.schoolMobile = schoolMobile || school.schoolMobile;

    // Only update the password if it's provided
    if (password) {
      school.password = password; // The pre-save hook will encrypt this automatically
    }

    // Save the updated school object (this will trigger the pre('save') middleware)
    const updatedSchool = await school.save();

    // Generate a new token if the username has changed (optional, based on your app logic)
    const payload = { id: updatedSchool._id, username: updatedSchool.username };
    const token = generateToken(payload);

    // Exclude the password from the response
    const schoolResponse = updatedSchool.toObject();
    delete schoolResponse.password;

    res.status(200).json({ response: schoolResponse, token, role: "schooladmin" });
  } catch (error) {
    console.error('Error during school update:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// router.put('/edit-branch/:id', superadminMiddleware, async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { branchName, email, schoolMobile, username, password } = req.body;

//     // Find the branch by ID
//     const existingBranch = await Branch.findById(id);
//     if (!existingBranch) {
//       return res.status(404).json({ error: 'Branch not found' });
//     }

//     // Check if the username is already taken by another branch
//     const duplicateUsernameBranch = await Branch.findOne({
//       _id: { $ne: id }, 
//       username 
//     });
    
//     if (duplicateUsernameBranch) {
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
router.put('/edit-branch/:id', superadminMiddleware, async (req, res) => {
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
router.put('/geofences/:id', async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  try {
    // Find the geofence by id and update only the name
    const updatedGeofence = await Geofencing.findByIdAndUpdate(
      id,
      { name }, // Only update the name field
      { new: true, runValidators: true } // Return the updated document and run validators
    );

    // If no geofence found with the given id
    if (!updatedGeofence) {
      return res.status(404).json({ message: 'Geofence not found' });
    }

    // Respond with the updated geofence
    res.status(200).json(updatedGeofence);
  } catch (error) {
    res.status(500).json({ message: 'Error updating geofence', error });
  }
});
router.put('/update-supervisor/:id', superadminMiddleware, async (req, res) => {
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
router.put('/update-driver/:id', superadminMiddleware, async (req, res) => {
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
router.put('/updateAccess/:id', superadminMiddleware, async (req, res) => {
  const { id } = req.params; // Using id instead of schoolId
  const { fullAccess } = req.body;

  try {
    // Validate that the fullAccess field is provided and is a boolean
    if (typeof fullAccess !== 'boolean') {
      return res.status(400).json({ error: 'Invalid value for fullAccess. It must be a boolean.' });
    }

    // Find the school by ID and update only the fullAccess field
    const updatedSchool = await School.findByIdAndUpdate(
      id,
      { fullAccess },
      { new: true, fields: { fullAccess: 1, schoolName: 1, _id: 1 } } // Return only necessary fields
    );

    if (!updatedSchool) {
      return res.status(404).json({ error: 'School not found' });
    }

    // Send the updated school info with the new fullAccess value
    res.status(200).json({
      message: 'fullAccess updated successfully',
      school: updatedSchool
    });
  } catch (error) {
    console.error('Error updating fullAccess:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});



// DELETE METHOD
router.delete('/delete/child/:childId', superadminMiddleware, async (req, res) => {
  const { childId } = req.params;

  try {
    // Find the child by ID
    const child = await Child.findById(childId).lean();
    if (!child) {
      return res.status(404).json({ error: 'Child not found' });
    }

    let parentData = {};
    if (child.parentId) {
      // Find the parent
      const parent = await Parent.findById(child.parentId).lean();
      if (parent) {
        parentData = {
          parentName: parent.parentName,
          email: parent.email,
          phone: parent.phone,
          parentId: parent._id,
        };

        // Check if the parent has any other children
        const childCount = await Child.countDocuments({ parentId: child.parentId });
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
router.delete('/delete-parent/:id', superadminMiddleware, async (req, res) => {
  const parentId = req.params.id;

  try {
    // Find the parent by ID
    const parent = await Parent.findById(parentId).lean();
    if (!parent) {
      return res.status(404).json({ error: 'Parent not found' });
    }

    // Delete all children associated with the parent
    await Child.deleteMany({ parentId });

    // Delete the parent
    await Parent.findByIdAndDelete(parentId);

    res.status(200).json({ message: 'Parent and associated children deleted successfully' });
  } catch (error) {
    console.error('Error deleting parent:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.delete('/delete-driver/:id', superadminMiddleware, async (req, res) => {
  try {
    const { id: driverId } = req.params;

    // Find and delete the driver by ID
    const deletedDriver = await DriverCollection.findByIdAndDelete(driverId);

    if (!deletedDriver) {
      return res.status(404).json({ error: 'Driver not found' });
    }

    console.log('Deleted driver data:', JSON.stringify(deletedDriver, null, 2));
    res.status(200).json({ message: 'Driver deleted successfully' });
  } catch (error) {
    console.error('Error deleting driver:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.delete('/delete-supervisor/:id', superadminMiddleware, async (req, res) => {
  try {
    const { id: supervisorId } = req.params;

    // Find and delete the supervisor by ID
    const deletedSupervisor = await Supervisor.findByIdAndDelete(supervisorId);

    if (!deletedSupervisor) {
      return res.status(404).json({ error: 'Supervisor not found' });
    }

    console.log('Deleted supervisor data:', JSON.stringify(deletedSupervisor, null, 2));
    res.status(200).json({ message: 'Supervisor deleted successfully' });
  } catch (error) {
    console.error('Error deleting supervisor:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.delete('/delete-school/:id', superadminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    // Find the school by ID
    const school = await School.findOne({ _id: id });

    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }

    // Delete the school
    const deletedSchool = await School.deleteOne({ _id: id });

    if (deletedSchool.deletedCount === 0) {
      return res.status(500).json({ error: 'Failed to delete school' });
    }

    // Optionally: Delete associated branches if stored in a separate collection (if needed)
    // If branches are embedded within the school document, this step may not be required.
    if (school.branches && school.branches.length > 0) {
      const branchIds = school.branches.map(branch => branch._id);
      await School.updateMany(
        { _id: id },
        { $pull: { branches: { _id: { $in: branchIds } } } }
      );
    }

    res.status(200).json({ message: 'School and related branches deleted successfully' });
  } catch (error) {
    console.error('Error deleting school:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.delete('/delete-device/:actualDeviceId', superadminMiddleware, async (req, res) => {
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
router.delete('/geofences/:id', async (req, res) => {
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
router.delete('/delete-branch/:id', superadminMiddleware, async (req, res) => {
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

      await Child.deleteMany({ parentId: parent._id });
    }

    await Parent.deleteMany({ branchId: branch._id });


    await Supervisor.deleteMany({ branchId: branch._id });
    await DriverCollection.deleteMany({ branchId: branch._id });


    await Branch.deleteOne({ _id: id });

    res.status(200).json({ message: 'Branch and all related data deleted successfully' });
  } catch (error) {
    console.error('Error during branch deletion:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});





                  // new code start from here






router.patch('/updatedivicenamebyold',async (req,res)=> {

      const username = "schoolmaster";
      const password = 123456;
      const url = 'https://rocketsalestracker.com/api/devices';

  try {
    const response = await axios.get( url,{auth:{username,password}});
    const devicesFromApi = response.data;

    // console.log("pavan this is data check",devicesFromApi);
    

    for (let device of devicesFromApi) {
      const { id, name } = device;
      
      
      await Device.updateOne(
        { deviceId: id, deviceName:{$ne:name} },  
        { $set: { deviceName: name } }  
      );
      await DriverCollection.updateOne(
        { deviceId: id, deviceName:{$ne:name} },  
        { $set: { deviceName: name } } 
      );
      await Supervisor.updateOne(
        { deviceId: id, deviceName:{$ne:name} },  
        { $set: { deviceName: name } } 
      );
      await Child.updateMany( 
        { deviceId: id, deviceName:{$ne:name} },  
        { $set: { deviceName: name } } 
      );
      console.log("pavan check");
      
    }
    console.log('Device names updated successfully!');
   return res.status(200).json({
      message: 'updated DeviceName everywhere successfully',
    });
    } catch (error) {
    console.error('Error updating device names:', error);
  }
}

)




router.post("/branchgroup",superadminMiddleware, async (req, res) => {
    try {
        const { username, password, schoolName, branchName,phoneNo } = req.body;

        if (!username || !password) {
            return res.status(400).json({ message: "Username and Password fields are required" });
        }

      const existGroupbranches = await BranchGroup.findOne({username})

        if(!existGroupbranches){
        const branchGroup = new BranchGroup({
            username,
            password,
            school:schoolName,
            branches:branchName,
            phoneNo
        });
        
        await branchGroup.save();

        res.status(201).json({
            message: "Branch group created successfully",
            branchGroup
        });
}
else{
  return res.status(400).json({ message: "Username already exist" });

}
    } catch (error) {
        console.error("Error creating branch group:", error);
        res.status(500).json({ message: "Server error" });
    }
});


// router.get("/branchgroup",superadminMiddleware, async (req, res) => {
//   try {
//       const branchGroups = await BranchGroup.find() 
//                           .populate('school',"schoolName")
//                           .populate('branches',"branchName");

//       res.status(200).json({
//           message: "Branch groups retrieved successfully",
//           branchGroups
//       });
//   } catch (error) {
//       console.error("Error retrieving branch groups:", error);
//       res.status(500).json({ message: "Server error" });
//   }
// });




router.get("/branchgroup", superadminMiddleware, async (req, res) => {

  try {
    const branchGroups = await BranchGroup.find()
      .populate('school', 'schoolName') 
      .populate('branches', 'branchName')

    const transformedBranchGroups = branchGroups.map(branchGroup => {
      let decryptedPassword = 'No password';
      
      try {
        if (branchGroup.password) {
          decryptedPassword = decrypt(branchGroup.password); 
        }
      } catch (decryptError) {
        console.error(`Error decrypting password for BranchGroup ${branchGroup._id}:`, decryptError);
        decryptedPassword = 'Error decrypting password';
      }

      const formattedCreatedAt = moment(branchGroup.createdAt).format('DD-MM-YYYY');
      const formattedupdatedAt = moment(branchGroup.updatedAt).format('DD-MM-YYYY');

      return {
        ...branchGroup.toObject(), 
        password: decryptedPassword, 
        createdAt: formattedCreatedAt, 
        updatedAt:formattedupdatedAt
      };
    });

    res.status(200).json({
      message: "Branch groups retrieved successfully",
      branchGroups: transformedBranchGroups,
    });

  } catch (error) {
    console.error("Error retrieving branch groups:", error);
    res.status(500).json({ message: "Server error" });
  }
});



router.put("/branchgroup/:id",superadminMiddleware, async (req, res) => {
  try {
      const { id } = req.params; 
      const { username, password,phoneNo, school, branches} = req.body;

      if (!id) {
          return res.status(400).json({ message: "Id is required" });
      }      
      
      const updatedBranchGroup = await BranchGroup.findByIdAndUpdate(
          id,
          { username, password,phoneNo, school, branches },
          { new: true, runValidators: true } 
      );

      if (!updatedBranchGroup) {
          return res.status(404).json({ message: "Branch group not found" });
      }

      res.status(200).json({
          message: "Branch group updated successfully",
          branchGroup: updatedBranchGroup
      });
    
  } catch (error) {
      console.error("Error updating branch group:", error);
      res.status(500).json({ message: "Server error" });
  }
});


router.delete("/branchgroup/:id",superadminMiddleware, async (req, res) => {
  try {
      const { id } = req.params;
      const deletedBranchGroup = await BranchGroup.findByIdAndDelete(id);
      if (!deletedBranchGroup) {
          return res.status(404).json({ message: "Branch group not found" });
      }
      res.status(200).json({ message: "Branch group deleted successfully" });
  } catch (error) {
      console.error("Error deleting branch group:", error);
      res.status(500).json({ message: "Server error" });
  }
});




router.get("/branchgroupbyschool", async (req, res) => {
  try {
      const schoolId = req.query.schoolId;

      // if (!Types.ObjectId.isValid(schoolId)) {
      //     return res.status(400).json({ message: "Invalid school ID" });
      // }

      const branchGroups = await BranchGroup.find({ school: schoolId })
                                .populate('school',"schoolName")
                                .populate('branches',"branchName");

      res.status(200).json({
          message: "Branch groups retrieved successfully",
          branchGroups
      });
  } catch (error) {
      console.error("Error retrieving branch groups:", error);
      res.status(500).json({ message: "Server error" });
  }
});


router.post('/login/schooluser',async (req, res) => {
  const { username, password } = req.body;
  try {
    const schooluser = await BranchGroup.findOne({ username })
    .populate("school","schoolName" )
    .populate({
      path: "branches",
      select: "branchName",
      populate: {
        path: "devices", 
        select: "deviceName",
      }
    });

    if (!schooluser) {
      return res.status(400).json({ error: "Invalid username or password" });
    }
    const isMatch = await schooluser.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid username or password" });
    }
    const token = generateToken({ id: schooluser._id, username: schooluser.username });
    res.status(200).json({ success: true, message: "Login successful", token ,role: 'schoolUser',data:schooluser});
  } catch (err) {
    console.error("Error during login:", err);
    res.status(500).json({ error: "Server error" });
  }
});




module.exports = router;

