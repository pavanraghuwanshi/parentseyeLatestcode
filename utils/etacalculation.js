const Geofencing = require("../models/geofence");
const { fetchDataPosition } = require("../utils/alertsforwebapp");

let PositionDataArr = [];
let cachedGeofences = [];
const crossedGeofences = {}; // Cache to track geofences crossed by devices

// Periodically fetch geofences and positions
setInterval(async () => {
    try {
        PositionDataArr = await fetchDataPosition();
    } catch (error) {
        console.error("Error fetching position data:", error);
    }
}, 10000);

setInterval(async () => {
    try {
        cachedGeofences = await Geofencing.find();
    } catch (error) {
        console.error("Error fetching geofences:", error);
    }
}, 10000); // Refresh geofences every 10 

const THREE_HOURS = 3 * 60 * 60 * 1000;

const etaCalculation = async (socket) => {
    function calculateDistance(geofenceArea, latLong) {
        const regex = /Circle\(\s*([\d.-]+)\s+([\d.-]+)\s*,\s*(\d+)\s*\)/;
        const match = geofenceArea.match(regex);

        if (!match) {
            throw new Error("Invalid geofence area format");
        }

        const geofenceLat = parseFloat(match[1]);
        const geofenceLon = parseFloat(match[2]);
        const radius = parseFloat(match[3]);

        const [lat, lon] = latLong;

        const R = 6371;
        const dLat = (geofenceLat - lat) * (Math.PI / 180);
        const dLon = (geofenceLon - lon) * (Math.PI / 180);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat * (Math.PI / 180)) * Math.cos(geofenceLat * (Math.PI / 180)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    const etaAlertArr = [];
    const now = Date.now();

    try {
        for (const device of PositionDataArr) {
            const { deviceId, latitude: currLat, longitude: currLng, speed } = device;
            const latLong = [currLat, currLng];

            if (!speed || speed <= 5) continue;

            let nearestGeofence = null;
            let nearestDistance = Infinity;
            let nearestEta = null;

            for (const geofence of cachedGeofences) {
                if (geofence.deviceId && String(geofence.deviceId) !== String(deviceId)) {
                    continue;
                }

                const distance = calculateDistance(geofence.area, latLong);

                // Check if the device recently crossed this geofence
                const cacheKey = `${deviceId}-${geofence._id}`;
                if (crossedGeofences[cacheKey] && now - crossedGeofences[cacheKey] < THREE_HOURS) {
                    continue; // Skip geofence if muted for 3 hours
                }

                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestGeofence = geofence;
                    nearestEta = (distance / speed) * 60; // ETA in minutes
                }
            }

            if (nearestGeofence && nearestEta) {
                const cacheKey = `${deviceId}-${nearestGeofence._id}`;
                if (nearestDistance <= nearestGeofence.radius) {
                    // Mark geofence as crossed
                    crossedGeofences[cacheKey] = now;
                } else {
                    etaAlertArr.push({
                        deviceId,
                        geofenceName: nearestGeofence.name,
                        etaTime: nearestEta.toFixed(2),
                    });
                }
            }
        }

        socket.emit("etaAlerts", etaAlertArr);

        // console.log("etaAlerts",etaAlertArr)

        // Clean up crossed geofence cache (remove entries older than 3 hours)
        for (const [key, timestamp] of Object.entries(crossedGeofences)) {
            if (now - timestamp > THREE_HOURS) {
                delete crossedGeofences[key];
            }
        }
    } catch (error) {
        console.error("Error in ETA calculation:", error);
        socket.emit("error", { message: "Failed to calculate ETA" });
    }
};

exports.etaCalculationSocket = (io, socket) => {
    socket.on("disconnect", () => {
        console.log(`User ${socket.id} disconnected`);
    });

    const alertInterval = setInterval(() => {
        etaCalculation(socket);
    }, 10000);

    socket.on("disconnect", () => {
        clearInterval(alertInterval);
    });
};
