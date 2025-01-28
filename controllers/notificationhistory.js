const device = require("../models/device");
const Allalert = require("../models/notificationhistory");
const notificationTypes = require("../models/notificationtypes");





exports.createNotificationtypes = async(req,res)=>{

    
    try {
        const { 
            deviceId,
            schoolId,
            branchId,
            ignitionOn,
            ignitionOff,
            geofenceEnter,
            geofenceExit,
            studentPresent,
            studentAbsent,
            leaveRequestStatus 
        } = req.body;

        if (!Array.isArray(deviceId) || deviceId.length === 0) {
            return res.status(400).json({ message: "Device ID must be a non-empty array" });
        }

        const savedNotifications = [];
        const skippedNotifications = [];

        for (const id of deviceId) {
            const existingNotification = await notificationTypes.findOne({ deviceId: id });

            if (existingNotification) {
                skippedNotifications.push(id);
            } else {
                const newNotificationType = new notificationTypes({
                    deviceId: id,
                    schoolId,
                    branchId,
                    ignitionOn,
                    ignitionOff,
                    geofenceEnter,
                    geofenceExit,
                    studentPresent,
                    studentAbsent,
                    leaveRequestStatus
                });

                const savedNotification = await newNotificationType.save();
                savedNotifications.push(savedNotification);
            }
        }

        return res.status(201).json({
            message: "Notification types processed successfully",
            saved: savedNotifications,
            AlreadyExist: skippedNotifications
        });
    } catch (error) {
        console.error("Internal server error:", error);
        return res.status(500).json({ message: "Internal server error", error });
    }

};


exports.getNotificationTypes = async(req,res)=>{

        try {

            const getnotificationtypes = await notificationTypes.find().populate("schoolId","schoolName -_id")
                                                                        .populate("branchId","branchName -_id");


                
                 const deviceIds = getnotificationtypes.map((device) => device.deviceId);
                 
                 const getDeviceNames = await device.find({ deviceId: { $in: deviceIds } })
                                                    .select('deviceName').select('deviceId');
                    

                     const mergedData = getnotificationtypes.map((type) => {
                        const matchingDevice = getDeviceNames.find((device) => device.deviceId=== type.deviceId);
                        return {
                            ...type._doc,
                          deviceName: matchingDevice ? matchingDevice.deviceName : null,
                        };
                      });
                      console.log(mergedData)
                    

            if(getnotificationtypes){
                return res.status(200).json({data: mergedData,message: "Notification Types Fetches Successfully"});
            }
            
        } catch (error) {
            console.log("Internal server error",error);
            
        }
}


exports.updateNotificationTypes = async(req,res)=>{

            const id = req.params.id;
            const updateData = req.body;
        try {

            const updatenotificationtypes = await notificationTypes.findByIdAndUpdate(id, updateData, {
                new: true, 
                runValidators: true,
              });            

            if(!updatenotificationtypes){
                return res.status(200).json({message: "Notification Types Not Found For Given Device"});
            }
            res.status(200).json({ message: "User updated successfully", data: updatenotificationtypes });

            
        } catch (error) {
            console.log("Internal server error",error);
        }
}

exports.deleteNotificationTypes = async(req,res)=>{

    // const ids = Array.isArray(req.query.ids) ? req.query.ids : [req.query.ids];

    let ids = req.query.ids;
    if (ids) {
        ids = ids.split(','); 
    }

            try {

            const deletenotificationtypes = await notificationTypes.deleteMany({
                deviceId: { $in: ids } 
              });
            if(!deletenotificationtypes){
                return res.status(400).json({message: "Notification Types Not Found For Given Id"});
            }
            res.status(200).json({ message: "User Deleted successfully"});

            
        } catch (error) {
            console.log("Internal server error",error);
        }
}






// exports.getNotification = async (req, res) => {
//     try {
//         const { duration, startDate, endDate, deviceIds } = req.query;

//         if (!deviceIds) {
//             return res.status(400).json({ message: "Device IDs are required" });
//         }

//         const deviceIdsArray = deviceIds.split(',');
//         let queryStartDate, queryEndDate;

//         if (duration) {
//             const now = new Date();
//             switch (duration) {
//                 case "day":
//                     queryStartDate = new Date(now.setUTCHours(0, 0, 0, 0));
//                     queryEndDate = new Date(now.setUTCHours(23, 59, 59, 999));
//                     break;
//                 case "week":
//                     const weekStart = now.getDate() - now.getDay();
//                     queryStartDate = new Date(now.setDate(weekStart));
//                     queryStartDate.setUTCHours(0, 0, 0, 0);
//                     queryEndDate = new Date(now.setDate(weekStart + 6));
//                     queryEndDate.setUTCHours(23, 59, 59, 999);
//                     break;
//                 case "prevweek":
//                     const prevWeekStart = now.getDate() - now.getDay() - 7;
//                     queryStartDate = new Date(now.setDate(prevWeekStart));
//                     queryStartDate.setUTCHours(0, 0, 0, 0);
//                     queryEndDate = new Date(now.setDate(prevWeekStart + 6));
//                     queryEndDate.setUTCHours(23, 59, 59, 999);
//                     break;
//                 case "month":
//                     queryStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
//                     queryEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
//                     break;
//                 case "prevmonth":
//                     queryStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
//                     queryEndDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
//                     break;
//                 default:
//                     return res.status(400).json({ message: "Invalid duration value" });
//             }
//         } else if (startDate && endDate) {
//             const parseDate = (dateStr) => {
//                 const [day, month, year] = dateStr.split('-').map(Number);
//                 return new Date(year, month - 1, day);
//             };
//             queryStartDate = parseDate(startDate);
//             queryEndDate = parseDate(endDate);
//             queryEndDate.setUTCHours(23, 59, 59, 999);
//         } else {
//             return res.status(400).json({ message: "Either duration or startDate and endDate must be provided" });
//         }

//         const notifications = await Allalert.find({
//             deviceId: { $in: deviceIdsArray },
//             createdAt: { $gte: queryStartDate, $lte: queryEndDate }
//         });

//         res.status(200).json({ success: true, data: notifications });
//     } catch (error) {
//         res.status(500).json({ success: false, message: error.message });
//     }
// };

console.log();

exports.getNotification = async (req, res) => {
     try {
         const { duration, startDate, endDate, deviceIds } = req.query;
 
         if (!deviceIds) {
             return res.status(400).json({ message: "Device IDs are required" });
         }
 
         const deviceIdsArray = deviceIds.split(',');
         let queryStartDate, queryEndDate;
 
         if (duration) {
             const now = new Date();
             switch (duration) {
                 case "day":
                     queryStartDate = new Date(now.setUTCHours(0, 0, 0, 0));
                     queryEndDate = new Date(now.setUTCHours(23, 59, 59, 999));
                     break;
                 case "thisweek":
                     const weekStart = now.getDate() - now.getDay();
                     queryStartDate = new Date(now.setDate(weekStart));
                     queryStartDate.setUTCHours(0, 0, 0, 0);
                     queryEndDate = new Date(now.setDate(weekStart + 6));
                     queryEndDate.setUTCHours(23, 59, 59, 999);
                     break;
                 case "prevweek":
                     const prevWeekStart = now.getDate() - now.getDay() - 7;
                     queryStartDate = new Date(now.setDate(prevWeekStart));
                     queryStartDate.setUTCHours(0, 0, 0, 0);
                     queryEndDate = new Date(now.setDate(prevWeekStart + 6));
                     queryEndDate.setUTCHours(23, 59, 59, 999);
                     break;
                 case "month":
                     queryStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
                     queryEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
                     break;
                 case "prevmonth":
                     queryStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                     queryEndDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
                     break;
                 default:
                     return res.status(400).json({ message: "Invalid duration value" });
             }
         } else if (startDate && endDate) {
             queryStartDate = new Date(startDate);
             queryEndDate = new Date(endDate);
             queryEndDate.setUTCHours(23, 59, 59, 999);
         } else {
             return res.status(400).json({ message: "Either duration or startDate and endDate must be provided" });
         }
 
         const notifications = await Allalert.aggregate([
            {
                $lookup: {
                    from: "devices",
                    localField: "deviceId", 
                    foreignField: "deviceId", 
                    as: "device"
                }
            },
            {
                $unwind: "$device"
            },
            {
                $match: {
                    deviceId: { $in: deviceIdsArray },
                    createdAt: { $gte: queryStartDate, $lte: queryEndDate },
                    status: { $in: ["Entered", "Exited"] } 
                }
            },
            {
                $project: {
                    _id: 1, 
                    deviceId: 1, 
                    createdAt: 1, 
                    status: 1, 
                    deviceName: "$device.deviceName" 
                }
            }
        ]);
        
 
         res.status(200).json({ success: true, data: notifications });
     } catch (error) {
         res.status(500).json({ success: false, message: error.message });
     }
 };
 


 exports.getRecentExitedAlerts = async (req, res) => {
    try {
        
        const deviceIds = req.query.deviceIds;

        
        if (!deviceIds) {
            return res.status(400).json({
                success: false,
                message: "Missing 'deviceIds' query parameter"
            });
        }

       
        const deviceIdsArray = deviceIds.split(",");

        
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

        const notifications = await Allalert.find({
            deviceId: { $in: deviceIdsArray },
            createdAt: { $gte: twoHoursAgo },
            status: "Exited"
        });

        
        res.status(200).json({
            success: true,
            message: "Recent 'Exited' alerts fetched successfully",
            data: notifications
        });
    } catch (error) {
        console.error("Error fetching alerts:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch alerts",
            error: error.message
        });
    }
};

    
    
