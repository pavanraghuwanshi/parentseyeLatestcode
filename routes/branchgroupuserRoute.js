const express = require('express');
const router = express.Router();


const { authenticateBranchGroupUser } = require('../middleware/authmiddleware');
const { getChildByBranchGroup,registerParentByBranchgroup,approveParentByBranchgroup,presentchildrenByBranchgroup,updatechildByBranchgroup,deleteChildByBranchgroup, Pendingrequests, Approverequests, Deniedrequests,getDriverData, updateDriver, deletedriver, AddDevices, readSuperviserByBranchGroupUser, updateSupervisorByBranchGroupUser,deleteSupervisorByBranchGroupUser, getGeofence, deleteGeofence, getDevices, updateDevice, updateGeofence, ApproveSupervisor, ApproveDriver, getParentByBranchgroup, updateParentByBranchgroup, deleteParentByBranchgroup, absentchildrenByBranchgroup, deletedeviceByBranchgroup } = require('../controllers/branchgroupuserController');



               // parent Api for Branch Group User
router.post("/registerparentbybranchgroup",authenticateBranchGroupUser,registerParentByBranchgroup)
router.get("/getparentbybranchgroup",authenticateBranchGroupUser,getParentByBranchgroup)
router.put("/updateparentbybranchgroup/:id",authenticateBranchGroupUser,updateParentByBranchgroup)
router.delete("/deleteparentbybranchgroup/:id",authenticateBranchGroupUser,deleteParentByBranchgroup)
router.post("/approveParentByBranchgroup/:id",authenticateBranchGroupUser,approveParentByBranchgroup)



               //    Device Api for Branch Group User
router.post("/adddevicesbybranchgroupuser",authenticateBranchGroupUser,AddDevices)
router.get("/getdevicebranchgroupuser",authenticateBranchGroupUser,getDevices)
router.put("/updateDevicebranchgroupuser/:id",authenticateBranchGroupUser,updateDevice)
router.delete("/deletedevicebybranchgroup/:id",authenticateBranchGroupUser,deletedeviceByBranchgroup)





               //     Child All route for branch group user
router.get("/read-children",authenticateBranchGroupUser,getChildByBranchGroup)
router.get("/presentchildrenByBranchgroup",authenticateBranchGroupUser,presentchildrenByBranchgroup)
router.get("/absentchildrenByBranchgroup",authenticateBranchGroupUser,absentchildrenByBranchgroup)
router.put("/updatechildbybranchgroup/:id", authenticateBranchGroupUser,updatechildByBranchgroup )
router.delete("/deletechildbybranchgroup/:childId", authenticateBranchGroupUser,deleteChildByBranchgroup )



                    //  Supervisor All route for branch group user

router.get("/readSuperviserBybranchgroupuser",authenticateBranchGroupUser,readSuperviserByBranchGroupUser)
router.patch("/updateSupervisorByBranchGroupUser/:id", authenticateBranchGroupUser,updateSupervisorByBranchGroupUser )
router.delete("/deleteSupervisorByBranchGroupUser/:id", authenticateBranchGroupUser,deleteSupervisorByBranchGroupUser )
router.post("/approvesupervisor/:id",authenticateBranchGroupUser,ApproveSupervisor);






                    //   pending request of leave
router.get("/pendingrequests",authenticateBranchGroupUser,Pendingrequests);
router.get("/approverequests",authenticateBranchGroupUser,Approverequests);
router.get("/deniedrequests",authenticateBranchGroupUser,Deniedrequests);








                    // Driver All crud
router.get("/getdriverdata",authenticateBranchGroupUser,getDriverData);
router.put("/updatedriverdata/:id",authenticateBranchGroupUser,updateDriver);
router.delete("/deletedriverdata/:id",authenticateBranchGroupUser,deletedriver);
router.post("/approvedriver/:id",authenticateBranchGroupUser,ApproveDriver);


                    // geofence all crud apis
router.get("/getgeofence",authenticateBranchGroupUser,getGeofence);
router.put("/updategeofence/:id",authenticateBranchGroupUser,updateGeofence );
router.delete("/deletegeofence/:id",authenticateBranchGroupUser,deleteGeofence);
   






module.exports = router;

