const axios = require('axios');
const Geofencing = require('../models/geofence');
const Request = require('../models/request');
const Attendance = require('../models/attendence');
const Allalert = require('../models/notificationhistory');
const notificationTypes = require('../models/notificationtypes');
const jwt = require('jsonwebtoken');
const branch = require('../models/branch');
const School = require('../models/school');
const { default: mongoose } = require('mongoose');
const BranchGroup = require('../models/branchgroup.model');

const date = new Date();

const formattedDate = `${date.getDate().toString().padStart(2, '0')}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getFullYear()}`;



let positionDataArray=[];
const fetchDataPosition = async () => {
     try {
          const alertData = await axios("https://rocketsalestracker.com/api/positions", { auth: { username: "schoolmaster", password: "123456" } })
          positionDataArray = alertData.data;
          return alertData.data;

     } catch (error) {
          console.log(error)
     }
}

setInterval(() => {
     fetchDataPosition();
}, 10000);


let prevIgnitionstate = []
let prevrequeststate = []
let prevStudAttendence = []
let globleAllAlert


const deviceGeofenceState = new Map();



const alertgeter = async () => {
     try {

          const ignitionalert = positionDataArray;

          const filterAtribute = ignitionalert?.map(obj => {

               const ignition = obj.attributes.ignition;
               const deviceId = obj.deviceId;
               return { ignition, deviceId };
          });


          let j = 0;
          const ignitionAlertArr = []
          for (const obj of filterAtribute??[]) {

               if (prevIgnitionstate.length > 0 && prevIgnitionstate.length == filterAtribute.length && obj.ignition != prevIgnitionstate[j].ignition) {
                    const ignition = obj.ignition
                    const deviceId = obj.deviceId
                    ignitionAlertArr.push({ deviceId, ignition })

               }
               j++;

          }


          prevIgnitionstate = [...filterAtribute?? []]

     //-----------------------------------------------------new coding stared from here------------------------------

           
          const getGeofences = await Geofencing.find();
          const geofenceAlertArr = [];
          
          for (const device of positionDataArray) {
              const { deviceId, latitude: currLat, longitude: currLng } = device;
          
              for (const geofence of getGeofences) {
                  if (geofence.deviceId && String(geofence.deviceId) !== String(deviceId)) {
                      continue;
                  }
          
                  const { name } = geofence;
                  
                  const latLong = [currLat, currLng];
                  const isInside = isPointInHaversine(geofence.area, latLong);                  
                  
                  
                  const previousState = deviceGeofenceState.get(deviceId)?.[name];
          
                  if (previousState !== undefined && previousState !== isInside) {      

                      geofenceAlertArr.push({
                          status: isInside ? "Entered" : "Exited",
                          deviceId,
                          geofenceName: name,
                          timestamp: new Date(),
                      });
          
                    }
                    if (!deviceGeofenceState.has(deviceId)) {
                        deviceGeofenceState.set(deviceId, {});
                    }
                    deviceGeofenceState.get(deviceId)[name] = isInside;
              }
          }
          // console.log(geofenceAlertArr,"geofenceAlertArraaaaaaaa")
          
          await Promise.all(getGeofences.map((geofence) => geofence.save()));
          
          function parseCircle(area) {
              area = area.replace(/\s+/g, ' ').trim();
              const regex = /Circle\(\s*([-.\d]+)\s+([-.\d]+),\s*([.\d]+)\s*\)/;
              const match = area.match(regex);
              if (!match) {
                  throw new Error("Invalid area format");
              }
              const centerLat = parseFloat(match[1]);
              const centerLon = parseFloat(match[2]);
              const radius = parseFloat(match[3]);
              return {
                  center: { lat: centerLat, lon: centerLon },
                  radius: radius,
              };
          }
          
          function isPointInHaversine(area, point) {
              const parsedCircle = parseCircle(area);
              const { center, radius } = parsedCircle;
              const { lat: centerLat, lon: centerLon } = center;
              const [pointLat, pointLon] = point;
              const earthRadius = 6371 * 1000;
              const toRadians = (degrees) => (degrees * Math.PI) / 180;
              const dLat = toRadians(pointLat - centerLat);
              const dLon = toRadians(pointLon - centerLon);
              const a =
                  Math.sin(dLat / 2) ** 2 +
                  Math.cos(toRadians(centerLat)) *
                  Math.cos(toRadians(pointLat)) *
                  Math.sin(dLon / 2) ** 2;
              const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
              const distance = earthRadius * c;
              return distance <= radius;
          }
          
           

     //----------------------------------------------------new coding end from here---------------------------------
          
          



          const getrequestnotifications = await Request.find();


          let k = 0
          const requestAlertArr = []
          for (const obj of getrequestnotifications) {

               if (prevrequeststate?.length == getrequestnotifications.length && obj.statusOfRequest !== prevrequeststate[k].statusOfRequest) {
                    const requestType = obj.requestType
                    const requestAlert = obj.statusOfRequest
                    const parentId = obj.parentId
                    const schoolId = obj.schoolId
                    const branchId = obj.branchId
                    requestAlertArr.push({ requestType, requestAlert, parentId,schoolId,branchId });
               }

               k++;

          }

          if (prevrequeststate.length >0 && getrequestnotifications.length > prevrequeststate.length) {
               const count = prevrequeststate.length;
               const modifiedRequestLeave = getrequestnotifications.slice(count);  

               modifiedRequestLeave.map(obj=>{

                    const requestType = obj.requestType
                    const requestAlert = obj.statusOfRequest
                    const parentId = obj.parentId
                    const schoolId = obj.schoolId
                    const branchId = obj.branchId
                    requestAlertArr.push({ requestType, requestAlert, parentId,schoolId,branchId });
               })

           }

          prevrequeststate = [...getrequestnotifications]



          const StudAttendence = await Attendance.find({ date: formattedDate });

          let n = 0;
          const StudAttendenceAlert = []
          for (const obj of StudAttendence) {
              
               const prevStudAttendenceFinddata = prevStudAttendence.find(prev => prev?.childId?.toString() === obj?.childId?.toString());                         

               if (prevStudAttendence.length > 0 && prevStudAttendenceFinddata && prevStudAttendenceFinddata.pickup!== obj.pickup) {

                    const childId = obj.childId
                    const pickup = obj.pickup
                    const drop = obj.drop
                    const pickupTime = obj.pickupTime
                    const dropTime = obj.dropTime
                    const schoolId = obj.schoolId
                    const branchId = obj.branchId


                    StudAttendenceAlert.push({ childId, pickup, drop, pickupTime, dropTime, schoolId, branchId });

               }
               if(prevStudAttendence.length > 0 && prevStudAttendenceFinddata && prevStudAttendenceFinddata.drop!== obj.drop){
                    const childId = obj.childId
                    const pickup = obj.pickup
                    const drop = obj.drop
                    const pickupTime = obj.pickupTime
                    const dropTime = obj.dropTime
                    const schoolId = obj.schoolId
                    const branchId = obj.branchId


                    StudAttendenceAlert.push({ childId, pickup, drop, pickupTime, dropTime, schoolId, branchId });

               }

               n++;

          }

          if (prevStudAttendence.length >0 && StudAttendence.length > prevStudAttendence.length) {
               const count = prevStudAttendence.length;
               const modifiedAttendence = StudAttendence.slice(count);  

               StudAttendenceAlert.push(...modifiedAttendence)

           }

          prevStudAttendence = [...StudAttendence];


          

               const allAlerts = [...geofenceAlertArr, ...ignitionAlertArr, ...requestAlertArr, ...StudAttendenceAlert]

               globleAllAlert =  allAlerts;
               // console.log("allAlerts", allAlerts);



               
               const getnotificationtypes = await notificationTypes.find();

               let matchedDeviceAlerts = [...requestAlertArr, ...StudAttendenceAlert, ...geofenceAlertArr,...ignitionAlertArr]
               getnotificationtypes?.forEach(item1 => {
                    const match = allAlerts.find(item => item.deviceId === item1.deviceId);
                  
                    if (match) {
                         matchedDeviceAlerts.push(match)
                    }
               });
               
               // globleAllAlert =  matchedDeviceAlerts; 

               // console.log("allAlerts2", globleAllAlert);


               if(allAlerts.length>0){

                    // console.log("allAlerts inner", allAlerts);
               try {
               await Allalert.insertMany(allAlerts);
               // console.log('Alerts saved successfully!');
               } catch (error) {
               console.error('Error saving alerts:', error);
               }
           
          }


     } catch (error) {

          console.log('Internal server error',error);
          
          // socket.emit("msg", 'Internal server error');
     }
}

alertgeter()
setInterval(() => {
     alertgeter()

}, 10000);


const deviceByLoginusr = async(loginUsersId,role,socket)=>{

     let globleDevicesBybranchId,clearLoginRoleWiseFilterInterval
     socket.on("disconnect", (reason) => {
          console.log(`User ${socket.id} disconnected. Reason: ${reason}`);
          clearInterval(clearLoginRoleWiseFilterInterval);
     });

     try {
          if(role && role=="branch"){

               const devicesByLoginBranchId = await branch.findById(loginUsersId)
                                                       .select("devices")
                                                       .populate("devices", "deviceId -_id");
     
                         globleDevicesBybranchId = devicesByLoginBranchId     
                         
                         clearLoginRoleWiseFilterInterval = setInterval(() => {
                         BranchLoginRoleWiseFilter(globleDevicesBybranchId,socket);                        
                    }, 10000);
          }

          if(role && role=="school"){
               
                              
                const branches = await branch.find({ _id: { $in: loginUsersId } })
                                             .populate('devices', 'deviceId -_id');
                    
               const allDeviceIdsOfSchool = branches.flatMap(branch => branch.devices.map(device => device.deviceId));

                         // console.log("school",allDeviceIdsOfSchool);

                         clearLoginRoleWiseFilterInterval = setInterval(() => {
                              SchoolLoginRoleWiseFilter(allDeviceIdsOfSchool,socket);                        
                         }, 10000);
          }

          if(role && role=="branchGroupUser"){
               
                              
                const branches = await branch.find({ _id: { $in: loginUsersId } })
                                             .populate('devices', 'deviceId -_id');
                    
               const allDeviceIdsOfBranchGroupUser = branches.flatMap(branch => branch.devices.map(device => device.deviceId));

                         // console.log("allDeviceIdsOfBranchGroupUser",allDeviceIdsOfBranchGroupUser);

                         clearLoginRoleWiseFilterInterval = setInterval(() => {
                              BranchGroupUserLoginRoleWiseFilter(allDeviceIdsOfBranchGroupUser,socket);                        
                         }, 10000);
          }         
          
     } catch (error) {
          console.log("Internal server error",error);
          
     }
}


const BranchLoginRoleWiseFilter = (globleDevices,socket)=>{

          try {

               if(globleDevices){

                    const  getDevicesArray = globleDevices.devices                    
          
                   const globleMatchedDevices = globleAllAlert.filter(alert => 
                         getDevicesArray.some(device => Number(device.deviceId )=== Number(alert.deviceId))
                     );
     
                    // console.log("branch notification",globleMatchedDevices);


                         if(globleMatchedDevices?.length>0){
                              socket.emit("allAlerts", globleMatchedDevices)
                              
                         }

               }
                        
          } catch (error) {
               console.log("Internal server error", error);
               
          }
}

const SchoolLoginRoleWiseFilter = (globleDevices,socket)=>{

          try {

               if(globleDevices){
                    
                    const globleMatchedDevices = globleAllAlert.filter(alert =>
                         globleDevices.some(deviceId => Number(deviceId) === Number(alert.deviceId))
                       );
     
                    // console.log("school Notification",globleMatchedDevices);


                         if(globleMatchedDevices?.length>0){
                              socket.emit("allAlerts", globleMatchedDevices)

                              console.log("alert check pavan ", globleMatchedDevices)
                              
                         }
          
               }      
          } catch (error) {
               console.log("Internal server error", error);
               
          }
}

const BranchGroupUserLoginRoleWiseFilter = (globleDevices,socket)=>{

     try {

          if(globleDevices){
               
               const globleMatchedDevices = globleAllAlert.filter(alert =>
                    globleDevices.some(deviceId => Number(deviceId) === Number(alert.deviceId))
                  );

               // console.log("Branch Group User Notification",globleMatchedDevices);

                    if(globleMatchedDevices?.length>0){
                         socket.emit("allAlerts", globleMatchedDevices)
                         
                    }
     
          }      
     } catch (error) {
          console.log("Internal server error", error);
          
     }
}






const ab = (io, socket) => {


     let alertInterval

     socket.on("disconnect", (reason) => {
          // console.log(`User ${socket.id} disconnected. Reason: ${reason}`);
          clearInterval(alertInterval);
     });

     socket.on("authenticate", (data) => {
          const token = data.token;
          let loginUsersId;
          let role;               

          if (!token) {
              console.log("Authentication error: No token provided");
              socket.emit("notification", { message: "Authentication error: No token provided" });
              return;
          }
  
          jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
              if (err) {
                  console.log("Authentication error: Invalid token");
                  socket.emit("notification", { message: "Authentication error: Invalid token" });
                  return;
              }

              role = decoded.role
              if(role=="branch"){
               loginUsersId = decoded.id              
          }
          if(role=="school"){
               loginUsersId = decoded.branches    
           
          }
          if(role=="branchGroupUser"){

               loginUsersId = decoded.branches               
          }
          if(role=="parent"){

               loginUsersId = decoded.parent               
          }
  
             
          //     console.log("BranchIds For filtering :", loginUsersId);
  
              socket.emit("notification", { message: "Successfully authenticated!" });
          });

          deviceByLoginusr(loginUsersId,role,socket)

      });


     // setInterval(() => {

     //           if(globleAllAlert?.length>0){
     //                socket.emit("allAlerts", globleAllAlert)
     //                // console.log("globleAllAlert",globleAllAlert);
                    
     //           }

     // }, 10000);

     // deviceByLoginusr()
     
     // io.to(socket.id).emit("msg","i am msg")
}

module.exports = {ab,fetchDataPosition};