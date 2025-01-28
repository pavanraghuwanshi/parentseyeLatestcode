const Geofencing = require("../models/geofence");
const { fetchDataPosition } = require("../utils/alertsforwebapp");

let PositionDataArr = [];

// Periodically fetch geofences and positions
setInterval(async () => {
    try {
        PositionDataArr = await fetchDataPosition();
    } catch (error) {
        console.error("Error fetching position data:", error);
    }
}, 10000);


const etaCalculation = async (socket) => {
    socket.on("disconnect", () => {
        clearInterval(alertInterval);
    });

    const alertInterval = setInterval(async () => {
        try {
            function calculateDistance(geofenceArea, latLong) {
                const regex = /Circle\(\s*([\d.-]+)\s+([\d.-]+)\s*,\s*(\d+)\s*\)/;
                const match = geofenceArea.match(regex);

                if (!match) {
                    throw new Error('Invalid geofence area format');
                }

                const geofenceLat = parseFloat(match[1]);
                const geofenceLon = parseFloat(match[2]);
                const radius = parseFloat(match[3]);

                const [lat, lon] = latLong;

                const R = 6371;
                const dLat = (geofenceLat - lat) * (Math.PI / 180);
                const dLon = (geofenceLon - lon) * (Math.PI / 180);
                const a =
                    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(lat * (Math.PI / 180)) * Math.cos(geofenceLat * (Math.PI / 180)) *
                    Math.sin(dLon / 2) * Math.sin(dLon / 2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                const distance = R * c;
                return distance;
            }

            const etaAlertArr = [];
            const EtadeviceId = socket.deviceId;

            const getGeofences = await Geofencing.find({ deviceId: EtadeviceId });

            for (const device of PositionDataArr) {
                const { deviceId, latitude: currLat, longitude: currLng } = device;
                const latLong = [currLat, currLng];

                for (const geofence of getGeofences) {
                    if (geofence.deviceId && String(geofence.deviceId) !== String(deviceId)) {
                        continue;
                    }

                    const distance = calculateDistance(geofence.area, latLong);

                    const speed = device.speed;
                    const eta = distance / speed * 60;

                    if (speed > 5) {
                        etaAlertArr.push({
                            deviceId,
                            geofenceName: geofence.name,
                            etaTime: eta.toFixed(2),
                        });
                        globleEtaArr = [...etaAlertArr];
                    }
                }
            }
            console.log("etaAlertArr", etaAlertArr);
            socket.emit("etaAlerts", etaAlertArr);
        } catch (error) {
            console.error("Error in ETA calculation:", error.message);
        }
    }, 10000);
};


exports.etaCalculationSocket = (io, socket) => {
    socket.on("disconnect", () => {
        console.log(`User ${socket.id} disconnected`);
    });

    socket.on("getDeviceId", (data) => {

        socket.deviceId = data.DeviceId;

        etaCalculation(socket);

    })
    
    
    // const alertInterval = setInterval(() => {
        //     etaCalculation();
        // }, 10000);
        
        // socket.on("disconnect", () => {
        //     clearInterval(alertInterval);
        // });
    
};
