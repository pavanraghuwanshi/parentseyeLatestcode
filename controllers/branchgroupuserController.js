const { generateToken } = require("../jwt");
const Parent = require("../models/Parent");
const School = require("../models/school");
const Branch = require('../models/branch');
const Attendance = require("../models/attendence");
const Child = require("../models/child");
const Geofencing = require("../models/geofence");
const branch = require("../models/branch");
const Request = require("../models/request");
const DriverCollection = require("../models/driver");
const Device = require('../models/device');

const { default: mongoose } = require("mongoose");
const Supervisor = require("../models/supervisor");
const { decrypt } = require("../models/cryptoUtils");
const { formatDateToDDMMYYYY } = require("../utils/dateUtils");


const convertDate = (dateStr) => {
  const dateParts = dateStr.split('-');
  const jsDate = new Date(`${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`);
  return {
    date: dateStr,
    originalDate: jsDate
  };
}



              //  Parent All Api For Branch Group User

exports.registerParentByBranchgroup = async (req, res) => {
  try {
    const {
      parentName,
      email,
      password,
      phone,
      childName,
      class: childClass,
      rollno,
      section,
      schoolName,
      branchName,
      dateOfBirth,
      childAge,
      gender,
      pickupPoint,
      deviceName,
      deviceId,
      fcmToken 
    } = req.body;
    if (!schoolName || !branchName) {
      return res.status(400).json({ error: 'School name and branch name are required' });
    }
    const existingParent = await Parent.findOne({ email });
    if (existingParent) {
      return res.status(400).json({ error: 'Parent email already exists' });
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
    const newParent = new Parent({
      parentName,
      email,
      password, 
      phone,
      fcmToken ,
      schoolId: school._id,
      branchId: branch._id,
      statusOfRegister: 'pending'
    });
    await newParent.save();

    // Create new child linked to the school, branch, and parent
    const newChild = new Child({
      childName,
      class: childClass,
      rollno,
      section,
      schoolId: school._id,
      branchId: branch._id, 
      dateOfBirth,
      childAge,
      gender,
      pickupPoint,
      deviceName,
      deviceId,
      parentId: newParent._id
    });
    await newChild.save();

    // Link child to parent
    newParent.children.push(newChild._id);
    await newParent.save();

    // Generate JWT token
    const payload = { id: newParent._id, email: newParent.email, schoolId: school._id, branchId: branch._id };
    const token = generateToken(payload);

    res.status(201).json({ parent: newParent, child: newChild, token });
  } catch (error) {
    console.error('Error during registration:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.approveParentByBranchgroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body;
    // const { schoolId } = req;

    const parent = await Parent.findOne({ _id: id });
    if (!parent) {
      return res.status(404).json({ error: 'Parent not found or does not belong to this user' });
    }

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
};

exports.getParentByBranchgroup =  async (req, res) => {
  try {

    const schoolName = req.user.school          

    const schools = await School.find({schoolName}).lean();
    
    const branchGroupUserData = [];

    await Promise.all(schools.map(async (school) => {
      const schoolId = school._id;
      const schoolName = school.schoolName;

      const branches = await Branch.find({ schoolId }).lean();

      const branchesData = [];

      await Promise.all(branches.map(async (branch) => {
        const branchId = branch._id;
        const branchName = branch.branchName;

        const parents = await Parent.find({ schoolId, branchId })
          .populate('children', '_id childName registrationDate') 
          .lean();

        const transformedParents = await Promise.all(parents.map(async (parent) => {
          let decryptedPassword;
          try {
            decryptedPassword = decrypt(parent.password); 
          } catch (decryptError) {
            console.error(`Error decrypting password for parent ${parent.parentName}`, decryptError);
            decryptedPassword = null;
          }

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
            password: decryptedPassword, 
            registrationDate: formatDateToDDMMYYYY(new Date(parent.parentRegistrationDate)), 
            statusOfRegister: parent.statusOfRegister, 
            children: transformedChildren,
          };
        }));

        branchesData.push({
          branchId: branchId,
          branchName: branchName,
          parents: transformedParents
        });
      }));

      branchGroupUserData.push({
        schoolId: schoolId,
        schoolName: schoolName,
        branches: branchesData
      });
    }));

    res.status(200).json({
      data: branchGroupUserData
    });
  } catch (error) {
    console.error('Error fetching all parents:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.updateParentByBranchgroup =  async (req, res) => {
 
  const id = req.params.id;
  const { parentName, email, password, phone,branchId } = req.body;

  try {
    const parent = await Parent.findOne({ _id: id });
    
    if (!parent) {
      return res.status(404).json({ error: 'Parent not found or does not belong to this school' });
    }

    if (parentName) parent.parentName = parentName;
    if (email) parent.email = email;
    if (phone) parent.phone = phone;
    if (password) parent.password = password; 
    if (branchId) parent.branchId = branchId; 

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
};

exports.deleteParentByBranchgroup =  async (req, res) => {
  
  const id = req.params.id;

  try {
    const parent = await Parent.findOne({ _id: id }).lean();
    if (!parent) {
      return res.status(404).json({ error: 'Parent not found or does not belong to this school' });
    }

    await Child.deleteMany({ _id: { $in: parent.children } });

    await Parent.findByIdAndDelete(id);

    res.status(200).json({ message: 'Parent and associated children deleted successfully' });
  } catch (error) {
    console.error('Error deleting parent:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};



                  // Child and Parent Api for Branch Group user

exports.getChildByBranchGroup = async (req, res) => {
     try {

          const branches = req.user.branches          
          
          const childData = await Child.find({ branchId: branches })
          .populate("schoolId","schoolName" )
          .populate("parentId","-children")
          .populate("branchId","branchName" ) .lean();;

          const updatedChildData = childData.map((child) => {
            if (child.parentId && child.parentId.password) {
                try {
                    child.parentId.password = decrypt(child.parentId.password);
                } catch (error) {
                    console.error(`Error decrypting password for parent ${child.parentId._id}`, error);
                    child.parentId.password = null;
                }
            }
            return child;
        });

        res.status(200).json({
          message: "Child data retrieved successfully",
          updatedChildData
        });
      
     } catch (error) {

      res.status(500).json({ error: 'Internal server error p' });
      console.log(error)

     }
   }

exports.updatechildByBranchgroup = async (req, res) => {
  const { id } = req.params;
  
  const { schoolName, branchName, parentName, email, phone, password, deviceId, deviceName, ...updateFields } = req.body;

  try {
    const child = await Child.findById(id);
    if (!child) {
      return res.status(404).json({ error: 'Child not found' });
    }

    if (schoolName && branchName) {
      const school = await School.findOne({ schoolName: new RegExp(`^${schoolName.trim()}$`, 'i') }).populate('branches');
      if (!school) {
        return res.status(400).json({ error: 'School not found' });
      }

      const branch = school.branches.find(branch => branch.branchName.toLowerCase() === branchName.trim().toLowerCase());
      if (!branch) {
        return res.status(400).json({ error: 'Branch not found in the specified school' });
      }

      child.schoolId = school._id;
      child.branchId = branch._id;
    }

    if (deviceId) {
      child.deviceId = deviceId;
    }
    if (deviceName) {
      child.deviceName = deviceName;
    }

    Object.keys(updateFields).forEach((field) => {
      child[field] = updateFields[field];
    });

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

    await child.save(); 

    const updatedChild = await Child.findById(id).lean();
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
      // formattedRegistrationDate: formatDateToDDMMYYYY(new Date(updatedChild.registrationDate)),
    };

    res.status(200).json({ message: 'Child information updated successfully', child: transformedChild });
  } catch (error) {
    console.error('Error updating child information:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.deleteChildByBranchgroup =  async (req, res) => {
  const { childId } = req.params;
  // const { schoolId } = req;

  try {

    const child = await Child.findById(childId).lean();
    if (!child) {
      return res.status(404).json({ error: 'Child not found' });
    }
              

    let parentData = {};
    if (child.parentId) {

      const parent = await Parent.findOne({ _id: child.parentId }).lean();
      if (parent) {
        parentData = {
          parentName: parent.parentName,
          email: parent.email,
          phone: parent.phone,
          parentId: parent._id,
        };

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
};

                //  children status and In expand get all detail of student Api
                
// exports.getChildrenStatus =  async (req, res) => {

//   try {

//     const branchIds = req.user.branches          

//     const children = await Child.find({ branchId:{ $in: branchIds } })
//       .populate({
//         path: 'parentId',
//         select: 'parentName phone email password'
//       })
//       .populate({
//         path: 'branchId',
//         select: 'branchName'
//       })
//       .populate({
//         path: 'schoolId',
//         select: 'schoolName'
//       })
//       .lean();

//     if (children.length === 0) {
//       return res.status(404).json({ message: 'No children found for this school' });
//     }

//     const branchesMap = {};

//     for (const child of children) {
//       const parent = child.parentId;

//       const attendance = await Attendance.findOne({ childId: child._id })
//         .sort({ date: -1 })
//         .lean();

//       const request = await Request.findOne({ childId: child._id })
//         .sort({ requestDate: -1 })
//         .lean();

//       let supervisor = null;
//       if (child.deviceId) {
//         supervisor = await Supervisor.findOne({ deviceId: child.deviceId, schoolId }).lean();
//       }
//       const password = parent ? decrypt(parent.password) : 'Unknown Password';

//       if (attendance || request) {

//         const childData = {
//           childId: child._id,
//           childName: child.childName,
//           childClass: child.class,
//           childAge:child.childAge,
//           section:child.section,
//           childAge: child.childAge,
//           rollno: child.rollno,
//           deviceId: child.deviceId,
//           deviceName:child.deviceName,
//           gender: child.gender,
//           pickupPoint: child.pickupPoint,
//             parentName: parent ? parent.parentName : 'Parent not found',
//             parentNumber: parent ? parent.phone : 'Parent not found',
//             email:parent ? parent.email :"unknown email",
//             password: password,
//           ...(attendance && {
//             pickupStatus: attendance.pickup ? 'Present' : 'Absent',
//             dropStatus: attendance.drop ? 'Present' : 'Absent',
//             pickupTime: attendance.pickupTime,
//             dropTime: attendance.dropTime,
//             date: attendance.date
//           }),
//           ...(request && {
//               requestType: request.requestType,
//               startDate: formatDateToDDMMYYYY(request.startDate)|| 'N/A',
//               endDate: formatDateToDDMMYYYY(request.endDate) || 'N/A',
//               reason: request.reason || 'N/A',
//               newRoute: request.newRoute || 'N/A',
//               statusOfRequest: request.statusOfRequest || 'N/A',
//               requestDate: formatDateToDDMMYYYY(request.requestDate) || 'N/A'            
//           }),
//           ...(supervisor && {
//             supervisorName: supervisor.supervisorName
//           })
//         };

//         if (!branchesMap[child.branchId._id]) {
//           branchesMap[child.branchId._id] = {
//             branchId: child.branchId._id,
//             branchName: child.branchId.branchName,
//             children: []
//           };
//         }

//         branchesMap[child.branchId._id].children.push(childData);
//       }
//     }

//     const branches = Object.values(branchesMap);

//     const response = {
//       schoolId: schoolId,
//       schoolName: children[0].schoolId ? children[0].schoolId.schoolName : 'N/A',
//       branches
//     };

//     res.json(response);
//   } catch (error) {
//     console.error('Error fetching all children status:', error);
//     res.status(500).json({ message: 'Server error' });
//   }
// };







              //    Pickup And Drop status by Branch group user

              
exports.pickupdropstatusByBranchgroup =  async (req, res) => {
  try {
    const branchIds = req.user.branches          
    const schoolName = req.user.school          

    const attendanceRecords = await Attendance.find({})
      .populate({
        path: "childId",
        match: { branchId: { $in: branchIds } },
        populate: [
          { path: "parentId", select: "phone" }, 
          { path: "branchId", select: "branchName" }, 
          { path: "schoolId", select: "schoolName" } 
        ]
      })
      .lean();

    const branchesMap = {};

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

        if (!branchesMap[record.childId.branchId._id]) {
          branchesMap[record.childId.branchId._id] = {
            branchId: record.childId.branchId._id,
            branchName: record.childId.branchId.branchName,
            children: []
          };
        }

        branchesMap[record.childId.branchId._id].children.push(childData);
      });

    const branches = Object.values(branchesMap);

    const responseData = {
      schoolName,
      branches
    };

    res.status(200).json(responseData);
  } catch (error) {
    console.error("Error fetching attendance data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};



              //   Leave Apis Stage pending/approve/denied for branch group user

exports.Pendingrequests = async (req, res) => {
  try {
    const branches = req.user.branches; 

    const requestsByBranches = await Promise.all(branches.map(async (branchId) => {
      const branch = await Branch.findById(branchId).lean();
      if (!branch) return null;

      const branchName = branch.branchName;

      const requests = await Request.find({
        statusOfRequest: "pending",
        branchId: branchId,
      })
        .populate({
          path: "childId",
          select: "childName class deviceId deviceName",
        })
        .populate("parentId", "parentName email phone")
        .populate("schoolId", "schoolName")
        .lean();

      // const validRequests = requests.filter(
      //   (request) => request.parentId && request.childId
      // );

      // const formattedRequests = validRequests.map((request) => {
      //   const formattedRequest = {
      //     requestId: request._id,
      //     reason: request.reason,
      //     class: request.childId.class,
      //     statusOfRequest: request.statusOfRequest,
      //     parentId: request.parentId._id,
      //     parentName: request.parentId.parentName,
      //     phone: request.parentId.phone,
      //     email: request.parentId.email,
      //     childId: request.childId._id,
      //     childName: request.childId.childName,
      //     requestType: request.requestType,
      //     deviceId: request.childId.deviceId,
      //     deviceName: request.childId.deviceName,
      //     requestDate: request.requestDate
      //       ? formatDateToDDMMYYYY(new Date(request.requestDate))
      //       : null,
      //     branchName: branchName,
      //   };

      //   if (request.requestType === "leave") {
      //     formattedRequest.startDate = request.startDate
      //       ? formatDateToDDMMYYYY(new Date(request.startDate))
      //       : null;
      //     formattedRequest.endDate = request.endDate
      //       ? formatDateToDDMMYYYY(new Date(request.endDate))
      //       : null;
      //   } else if (request.requestType === "changeRoute") {
      //     formattedRequest.newRoute = request.newRoute || null;
      //   }

      //   return formattedRequest;
      // });

      return {
        branchId: branchId,
        branchName: branchName,
        requests
      };
    }));

    const filteredBranches = requestsByBranches.filter(branch => branch !== null);

    res.status(200).json({
      data: filteredBranches,
    });
  } catch (error) {
    console.error("Error fetching pending requests:", error);
    res.status(500).json({
      error: "Internal server error",
    });
  }
};

exports.Approverequests = async (req, res) => {
  try {
    const branches = req.user.branches; 

    const requestsByBranches = await Promise.all(branches.map(async (branchId) => {
      const branch = await Branch.findById(branchId).lean();
      if (!branch) return null;

      const branchName = branch.branchName;

      const requests = await Request.find({
        statusOfRequest: "approved",
        branchId: branchId,
      })
        .populate({
          path: "childId",
          select: "childName class deviceId deviceName",
        })
        .populate("parentId", "parentName email phone")
        .populate("schoolId", "schoolName")
        .lean();

      // const validRequests = requests.filter(
      //   (request) => request.parentId && request.childId
      // );

      // const formattedRequests = validRequests.map((request) => {
      //   const formattedRequest = {
      //     requestId: request._id,
      //     reason: request.reason,
      //     class: request.childId.class,
      //     statusOfRequest: request.statusOfRequest,
      //     parentId: request.parentId._id,
      //     parentName: request.parentId.parentName,
      //     phone: request.parentId.phone,
      //     email: request.parentId.email,
      //     childId: request.childId._id,
      //     childName: request.childId.childName,
      //     requestType: request.requestType,
      //     deviceId: request.childId.deviceId,
      //     deviceName: request.childId.deviceName,
      //     requestDate: request.requestDate
      //       ? formatDateToDDMMYYYY(new Date(request.requestDate))
      //       : null,
      //     branchName: branchName,
      //   };

      //   if (request.requestType === "leave") {
      //     formattedRequest.startDate = request.startDate
      //       ? formatDateToDDMMYYYY(new Date(request.startDate))
      //       : null;
      //     formattedRequest.endDate = request.endDate
      //       ? formatDateToDDMMYYYY(new Date(request.endDate))
      //       : null;
      //   } else if (request.requestType === "changeRoute") {
      //     formattedRequest.newRoute = request.newRoute || null;
      //   }

      //   return formattedRequest;
      // });

      return {
        branchId: branchId,
        branchName: branchName,
        requests
      };
    }));

    const filteredBranches = requestsByBranches.filter(branch => branch !== null);

    res.status(200).json({
      data: filteredBranches,
    });
  } catch (error) {
    console.error("Error fetching pending requests:", error);
    res.status(500).json({
      error: "Internal server error",
    });
  }
};

exports.Deniedrequests = async (req, res) => {
  try {
    const branches = req.user.branches; 

    const requestsByBranches = await Promise.all(branches.map(async (branchId) => {
      const branch = await Branch.findById(branchId).lean();
      if (!branch) return null;

      const branchName = branch.branchName;

      const requests = await Request.find({
        statusOfRequest: "denied",
        branchId: branchId,
      })
        .populate({
          path: "childId",
          select: "childName class deviceId deviceName",
        })
        .populate("parentId", "parentName email phone")
        .populate("schoolId", "schoolName")
        .lean();

      // const validRequests = requests.filter(
      //   (request) => request.parentId && request.childId
      // );

      // const formattedRequests = validRequests.map((request) => {
      //   const formattedRequest = {
      //     requestId: request._id,
      //     reason: request.reason,
      //     class: request.childId.class,
      //     statusOfRequest: request.statusOfRequest,
      //     parentId: request.parentId._id,
      //     parentName: request.parentId.parentName,
      //     phone: request.parentId.phone,
      //     email: request.parentId.email,
      //     childId: request.childId._id,
      //     childName: request.childId.childName,
      //     requestType: request.requestType,
      //     deviceId: request.childId.deviceId,
      //     deviceName: request.childId.deviceName,
      //     requestDate: request.requestDate
      //       ? formatDateToDDMMYYYY(new Date(request.requestDate))
      //       : null,
      //     branchName: branchName,
      //   };

      //   if (request.requestType === "leave") {
      //     formattedRequest.startDate = request.startDate
      //       ? formatDateToDDMMYYYY(new Date(request.startDate))
      //       : null;
      //     formattedRequest.endDate = request.endDate
      //       ? formatDateToDDMMYYYY(new Date(request.endDate))
      //       : null;
      //   } else if (request.requestType === "changeRoute") {
      //     formattedRequest.newRoute = request.newRoute || null;
      //   }

      //   return formattedRequest;
      // });

      return {
        branchId: branchId,
        branchName: branchName,
        requests
      };
    }));

    const filteredBranches = requestsByBranches.filter(branch => branch !== null);

    res.status(200).json({
      data: filteredBranches,
    });
  } catch (error) {
    console.error("Error fetching pending requests:", error);
    res.status(500).json({
      error: "Internal server error",
    });
  }
};

exports.ChangeStatusOfLeaveRequest = async (req, res) => {
  try {
    const { statusOfRequest } = req.body;
    const { id } = req.params;
    const { schoolId } = req;

    if (!["approved", "denied"].includes(statusOfRequest)) {
      return res.status(400).json({ error: "Invalid statusOfRequest" });
    }

    const request = await Request.findById(id);


    // Check if the request belongs to the school
    // if (request.schoolId.toString() !== schoolId.toString()) {
    //   return res
    //     .status(403)
    //     .json({ error: "Unauthorized to review this request" });
    // }
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
};



                  // Driver Apis for branch group user

exports.getDriverData = async (req, res) => {
  try {
    const branchId = req.user.branches;

    const drivers = await DriverCollection.find({ branchId: { $in: branchId } }) 
    .populate({ path: 'schoolId', select: 'schoolName' }) 
    .populate({ path: 'branchId', select: 'branchName' });

    

    if (!drivers) {
      return res.status(404).json({ error: 'Driver not found or does not belong to this branch group user' });
    }

    const response =  drivers.map(driver =>({

      id:driver._id,
      driverName: driver.driverName,
      driverMobile: driver.driverMobile,
      password:decrypt(driver.password),
      email: driver.email,
      address: driver.address,
      statusOfRegister: driver.statusOfRegister,
      deviceId: driver.deviceId,
      deviceName: driver.deviceName,
      schoolName: driver.schoolId.schoolName, 
      branchName: driver.branchId ? driver.branchId.branchName : 'N/A', 
      formattedRegistrationDate: formatDateToDDMMYYYY(driver.registrationDate)

    }));
    

    res.status(200).json({ drivers: response });
  } catch (error) {
    console.error('Error fetching drivers data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.updateDriver = async (req, res) => {
  try {
    const { driverName, address, driverMobile, email, deviceName, branchId,deviceId } = req.body;
   
    const id = req.params
    

    const driver = await DriverCollection.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(id) },
      { driverName, address, driverMobile, email, deviceName, branchId,deviceId },
      { new: true }
    );

    if (!driver) {
      return res.status(404).json({ error: "Driver not found or does not belong to the branch group user" });
    }

    res.status(200).json({ message: "Driver details updated successfully", driver });
  } catch (error) {
    console.error('Error updating driver details:', error);
    res.status(500).json({ error: "Error updating driver details" });
  }
};

exports.deletedriver = async (req, res) => {
  try {
    const  {id} = req.params;

    const deletedDriver = await DriverCollection.findByIdAndDelete({_id:id});

    if (!deletedDriver) {
      return res.status(404).json({ error: 'Driver not found' });
    }

    res.status(200).json({ message: 'Driver deleted successfully' });
  } catch (error) {
    console.error('Error deleting driver:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.ApproveDriver = async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body;

    const driver = await DriverCollection.findById(id);
    if (!driver) {
      return res.status(404).json({ error: 'driver not found' });
    }

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
};


                // Devices Api for Branch Group crud

exports.AddDevices = async (req, res) => {
  try {
    const { deviceId, deviceName, schoolName, branchName, ImeiNo} = req.body;
    if (!deviceId || !deviceName || !schoolName || !branchName || !ImeiNo) {
      return res.status(400).json({ message: 'All fields (deviceId, deviceName, schoolName, branchName,ImeiNo) are required' });
    }
    const school = await School.findOne({ schoolName: new RegExp(`^${schoolName.trim()}$`, 'i') }).populate('branches');
    if (!school) {
      return res.status(404).json({ message: 'School not found' });
    }
    const branch = school.branches.find(branch => branch.branchName.toLowerCase() === branchName.trim().toLowerCase());
    if (!branch) {
      return res.status(404).json({ message: 'Branch not found in the specified school' });
    }
    const existingDevice = await Device.findOne({ deviceId });
    const existingDeviceImeiNo = await Device.findOne({ ImeiNo });

    if (existingDevice || existingDeviceImeiNo) {
      return res.status(400).json({ message: 'Device with this ID & ImeiNo already exists' });
    }
    const newDevice = new Device({
      deviceId,
      deviceName,
      schoolId: school._id, 
      branchId: branch._id,
      ImeiNo,  
    });
    await newDevice.save();
    branch.devices.push(newDevice._id);
    await branch.save();
    res.status(201).json({ message: 'Device created successfully', device: newDevice });
  } catch (error) {
    console.error('Error adding device:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.getDevices = async (req, res) => {
  try {

    const schoolName =  req.user.school
    const BranchIds =  req.user.branches
    const schools = await School.find({schoolName}).lean();

    const dataBySchool = await Promise.all(
      schools.map(async (school) => {
        const schoolId = school._id;
        const schoolName = school.schoolName;

        const branches = await Branch.find({_id: { $in: BranchIds } }).lean();

        const devicesByBranch = await Promise.all(
          branches.map(async (branch) => {
            const branchId = branch._id;
            const branchName = branch.branchName;

            const devices = await Device.find({ schoolId: schoolId, branchId: branchId }).lean();

            const rawDevices = devices.map((device) => ({
              actualDeviceId: device._id, 
              deviceId: device.deviceId,  
              deviceName: device.deviceName, 
              registrationDate: device.registrationDate,
            }));

            return {
              branchId: branchId,
              branchName: branchName,
              devices: rawDevices,
            };
          })
        );

        return {
          schoolId: schoolId,
          schoolName: schoolName,
          branches: devicesByBranch,
        };
      })
    );

    res.status(200).json({
      data: dataBySchool,
    });
  } catch (error) {
    console.error('Error fetching devices by school:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.updateDevice = async (req, res) => {
  try {
    const { id } = req.params;
    const { deviceId, deviceName, branchName, schoolName } = req.body;

    if ( !deviceName || (branchName && !schoolName)) {
      return res.status(400).json({ message: 'deviceId, deviceName, and optionally branchName and schoolName are required' });
    }

    const existingDevice = await Device.findOne({
      deviceId,
      _id: { $ne: id } 
    });

    if (existingDevice) {
      return res.status(400).json({ message: 'Device with this deviceId already exists' });
    }

    const device = await Device.findById(id);
    console.log(device)
    console.log(id)

    if (!device) {
      return res.status(404).json({ message: 'Device not found p' });
    }

    device.deviceId = deviceId;
    device.deviceName = deviceName;

    if (branchName && schoolName) {
      const school = await School.findOne({ schoolName: new RegExp(`^${schoolName.trim()}$`, 'i') }).populate('branches');
      if (!school) {
        return res.status(404).json({ message: 'School not found' });
      }

      const branch = school.branches.find(branch => branch.branchName.toLowerCase() === branchName.trim().toLowerCase());
      if (!branch) {
        return res.status(404).json({ message: 'Branch not found in the specified school' });
      }

      if (!branch.devices.includes(device._id)) {
        branch.devices.push(device._id);
        await branch.save();
      }
    }

    await device.save();

    res.status(200).json({ message: 'Device updated successfully', device });
  } catch (error) {
    console.error('Error updating device:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.deletedeviceByBranchgroup =  async (req, res) => {
  try {
    const { id } = req.params;

    const device = await Device.findById(id);
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    await Device.deleteOne({ _id: id });

    res.status(200).json({ message: 'Device deleted successfully' });
  } catch (error) {
    console.error('Error deleting device:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};


              // geofence Apis for user

exports.getGeofence = async (req, res) => {
  const branches = req.user.branches;

  try {
    const devices = await Device.find({ branchId: { $in: branches } })
      .select('deviceId branchId deviceName password')
      .populate('branchId', 'branchName');
      
      
      const deviceIds = devices.map((device) => device.deviceId);

    const geofences = await Geofencing.find({ deviceId: { $in: deviceIds } });    

    const groupedGeofences = devices.reduce((acc, device) => {
      const branchId = device.branchId._id;
      const branchName = device.branchId.branchName;
      const deviceName = device.deviceName;

      if (!acc[branchId]) {
        acc[branchId] = {
          branchId,
          branchName,
          geofences: [],
        };
      }

      const branchGeofences = geofences
      .filter((geo) => geo.deviceId.toString() === device.deviceId.toString())
      .map((geo) => ({ ...geo._doc, deviceName }));

      acc[branchId].geofences.push(...branchGeofences);

      return acc;
    }, {});

    const result = Object.values(groupedGeofences);

    res.status(200).json({ branches: result });
  } catch (error) {
    console.error('Error fetching geofences:', error);
    res.status(500).json({ message: 'Error retrieving geofences', error });
  }
};

exports.deleteGeofence = async (req, res) => {
  const { id: geofenceId } = req.params;

  try {
    const deletedGeofence = await Geofencing.findByIdAndDelete(geofenceId);

    if (!deletedGeofence) {
      return res.status(404).json({ message: 'Geofence not found' });
    }

    res.status(200).json({
      message: 'Geofence deleted successfully',
      deletedGeofence: deletedGeofence 
    });
  } catch (error) {
    console.error('Error deleting geofence:', error);
    res.status(500).json({ message: 'Error deleting geofence', error });
  }
};

exports.updateGeofence =  async (req, res) => {
  const { id } = req.params;
  const { name ,area} = req.body;

  try {
    const updatedGeofence = await Geofencing.findByIdAndUpdate(
      id,
      { name,area }, 
      { new: true, runValidators: true } 
    );

    if (!updatedGeofence) {
      return res.status(404).json({ message: 'Geofence not found' });
    }

    res.status(200).json(updatedGeofence);
  } catch (error) {
    res.status(500).json({ message: 'Error updating geofence', error });
  }
};




                  // Get Present And Absent Child By branch Group user 

exports.presentchildrenByBranchgroup = async (req, res) => {
  try {
    const branchIds = req.user.branches; 

    const branches = await Branch.find({ _id: { $in: branchIds } }).lean();

    const dataByBranch = await Promise.all(
      branches.map(async (branch) => {
        const branchId = branch._id.toString();
        const branchName = branch.branchName;
        const schoolId = branch.schoolId.toString();

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
              date: record.date,
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

    res.status(200).json({ branches: dataByBranch });
  } catch (error) {
    console.error("Error fetching present pickup data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.absentchildrenByBranchgroup = async (req, res) => {

  try {
    const branchIds = req.user.branches; 
    const schoolName = req.user.school; 

    const attendanceRecords = await Attendance.find({ pickup: false })
      .populate({
        path: "childId",
        match: { branchId: { $in: branchIds } },
        populate: [
          { path: "parentId", select: "phone" },
          { path: "branchId", select: "branchName" },
          { path: "schoolId", select: "schoolName" }
        ]
      })
      .lean();

    const branchMap = {};

    attendanceRecords.forEach(record => {

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
    // const school = await School.findById(schoolId).lean();

    const responseData = {
      // schoolId: schoolId,
      schoolName: schoolName,
      branches: branches
    };

    res.status(200).json(responseData);
  } catch (error) {
    console.error("Error fetching absent children data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};




                      //  Supervisor All Api for branch group user

exports.readSuperviserByBranchGroupUser = async (req, res) => {
  const branches = req.user.branches    
  // console.log(branches)      
  

  try {
    const supervisors = await Supervisor.find({ branchId:branches })
      .populate("branchId", "branchName")
      .populate("schoolId", "schoolName")
      .lean();
      // console.log(supervisors)
    const supervisorData = supervisors.map((supervisor) => {
      try {
        // console.log(
        //   `Decrypting password for supervisor: ${supervisor.supervisorName}, encryptedPassword: ${supervisor.password}`
        // );
        const decryptedPassword = decrypt(supervisor.password);
        return {
          id : supervisor._id,
          supervisorName: supervisor.supervisorName,
          address: supervisor.address,
          phone_no: supervisor.phone_no,
          email: supervisor.email,
          deviceId: supervisor.deviceId,
          password: decryptedPassword,
          statusOfRegister:supervisor.statusOfRegister,
          deviceName:supervisor.deviceName,
          registrationDate: supervisor.registrationDate,
          formattedRegistrationDate: formatDateToDDMMYYYY(
            new Date(supervisor.registrationDate)
          ),
          branchName: supervisor.branchId.branchName, 
          schoolName: supervisor.schoolId.schoolName, 
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
};

exports.ApproveSupervisor =  async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body;

    const supervisor = await Supervisor.findById(id);
    if (!supervisor) {
      return res.status(404).json({ error: 'supervisor not found' });
    }

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
};

exports.updateSupervisorByBranchGroupUser = async (req, res) => {
  try {
    const { supervisorName, address, phone_no, email,deviceName, branchId,deviceId } = req.body;
    const supervisorId = req.params.id;

    // Update supervisor details, ensuring they belong to the correct school
    const supervisor = await Supervisor.findOneAndUpdate(
      { _id: supervisorId },
      { supervisorName, address, phone_no,deviceName, email,branchId,deviceId },
      { new: true }
    );

    if (!supervisor) {
      return res.status(404).json({ error: "Supervisor not found or does not belong to this school" });
    }

    return res.status(200).json({ message: "Supervisor details updated successfully", supervisor });
  } catch (error) {
    console.error("Error updating supervisor details:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.deleteSupervisorByBranchGroupUser = async (req, res) => {
  try {
    const supervisorId = req.params.id;
    const supervisor = await Supervisor.findByIdAndDelete(supervisorId);
    if (!supervisor) {
      return res.status(404).json({ error: 'Supervisor not found' });
    }
    return res.status(200).json({ message: 'Supervisor deleted successfully' });
  } catch (error) {
    console.error('Error during supervisor deletion:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};


                //  Student Status Api to check all data of student in one place 


exports.statusOfChildren =  async (req, res) => {
  try {
    const branchesIds = req.user.branches          
    const schoolName = req.user.school    
    

    const children = await Child.find({ branchId: { $in: branchesIds } })
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
      .lean();


    if (children.length === 0) {
      return res.status(404).json({ message: 'No children found for this school' });
    }

    const branchesMap = {};

    for (const child of children) {
      const parent = child.parentId;

      const attendance = await Attendance.findOne({ childId: child._id })
        .sort({ date: -1 })
        .lean();

      const request = await Request.findOne({ childId: child._id })
        .sort({ requestDate: -1 })
        .lean();

      let supervisor = null;
      if (child.deviceId) {
        const deviceId = child.deviceId
        supervisor = await Supervisor.findOne({deviceId,   branchId: { $in: branchesIds },}).lean();

        console.log(supervisor)

      }
      const password = parent ? decrypt(parent.password) : 'Unknown Password';
      if (attendance || request) {
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

        if (!branchesMap[child.branchId._id]) {
          branchesMap[child.branchId._id] = {
            branchId: child.branchId._id,
            branchName: child.branchId.branchName,
            children: []
          };
        }

        branchesMap[child.branchId._id].children.push(childData);
      }
    }

    const branches = Object.values(branchesMap);

    const response = {

      schoolName ,
      branches
    };


    res.json(response);
  } catch (error) {
    console.error('Error fetching all children status:', error);
    res.status(500).json({ message: 'Server error' });
  }
}


exports.childStatus = async (req, res) => {
  try {
    const { childId } = req.params;
    const branchesIds = req.user.branches          

    const child = await Child.findById( childId )
      .populate({
        path: 'parentId',
        select: 'parentName phone password email'
      })
      .populate({
        path: 'branchId', 
        select: 'branchName'
      })
      .populate({
        path: 'schoolId', 
        select: 'schoolName'
      })
      .lean(); 

    if (!child) {
      return res.status(404).json({ message: 'Child not found' });
    }

    const parent = child.parentId;
    const password = parent ? decrypt(parent.password) : 'Unknown Password';

    const attendance = await Attendance.findOne({ childId })
      .sort({ date: -1 })
      .limit(1);

    const request = await Request.findOne({ childId })
      .sort({ requestDate: -1 })
      .limit(1);

    let supervisor = null;
    if (child.deviceId) {
      supervisor = await Supervisor.findOne({ deviceId: child.deviceId });
    }

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

    if (request && request.startDate) response.startDate = formatDateToDDMMYYYY(request.startDate);
    if (request && request.endDate) response.endDate = formatDateToDDMMYYYY(request.endDate);
    if (request && request.requestDate) response.requestDate = formatDateToDDMMYYYY(request.requestDate);

    if (request && request.reason) response.reason = request.reason;
    if (request && request.newRoute) response.newRoute = request.newRoute;
    if (request && request.statusOfRequest) response.statusOfRequest = request.statusOfRequest;
    if (supervisor && supervisor.supervisorName) response.supervisorName = supervisor.supervisorName;

    res.json({child:response});
  } catch (error) {
    console.error('Error fetching child status:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

