const express = require('express');
const router = express.Router();

const { getNotification, createNotificationtypes, getNotificationTypes, updateNotificationTypes, deleteNotificationTypes, getRecentExitedAlerts } = require('../controllers/notificationhistory');


                    // Notification Types Crud 

router.get("/getnotificationtypes",getNotificationTypes)
router.post("/createnotification",createNotificationtypes)
router.put("/updatenotification/:id",updateNotificationTypes)
router.delete("/deletenotification",deleteNotificationTypes)

                    // Notification History

router.get("/notificationalerthistory",getNotification)

                    //  Get IsCrossed History
                    
router.get("/iscrossedhistory",getRecentExitedAlerts)




module.exports = router;

