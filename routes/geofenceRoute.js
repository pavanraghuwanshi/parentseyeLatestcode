const express = require("express");
const router = express.Router();
const Geofencing = require("../models/geofence");
require("dotenv").config();
const { formatDateToDDMMYYYY } = require("../utils/dateUtils");
const { jwtAuthMiddleware } = require("../jwt");

router.put("/isCrossed/", async (req, res) => {
  try {
    const { geofenceId } = req.query; // Extract geofenceId from query
    const { isCrossed, arrivalTime, departureTime } = req.body;

    // Validate geofenceId query parameter
    if (!geofenceId) {
      return res
        .status(400)
        .json({ message: "geofenceId query parameter is required" });
    }

    // Validate isCrossed field
    if (typeof isCrossed !== "boolean") {
      return res
        .status(400)
        .json({ message: "isCrossed must be a boolean value" });
    }

    // Build the update object dynamically based on the received fields
    const updateData = { isCrossed };
    if (arrivalTime) updateData.arrivalTime = arrivalTime;
    if (departureTime) updateData.departureTime = departureTime;

    // Find the geofence by its _id and update it
    const updatedGeofence = await Geofencing.findByIdAndUpdate(
      geofenceId,       // Find by _id
      { $set: updateData },  // Set the new data
      { new: true }          // Return the updated document
    );

    // Check if the geofence exists
    if (!updatedGeofence) {
      return res
        .status(404)
        .json({ message: "No geofencing data found for this geofenceId" });
    }

    // Respond with success and the updated document
    res.json({
      message: "Geofencing data updated successfully",
      data: updatedGeofence,
    });
  } catch (error) {
    // Handle server errors
    res.status(500).json({ message: "Server error", error: error.message });
  }
});
router.get("/", async (req, res) => {
  try {
    const deviceId = req.query.deviceId;

    const now = new Date();  // Get the current date and time
    const currentDate = now.toDateString();  // Convert the date to a string like "Tue Oct 10 2024"

    // Fetch geofencing data based on deviceId
    const geofencingData = await Geofencing.find({ deviceId });

    if (!geofencingData || geofencingData.length === 0) {
      return res.status(404).json({ message: "No geofencing data found for this deviceId" });
    }

    const updatedGeofencingData = await Promise.all(
      geofencingData.map(async (data) => {
        const lastUpdatedDate = new Date(data.lastUpdated).toDateString(); // Get the date part of lastUpdated

        // If the lastUpdated date is not today (after 12 AM), reset the fields
        if (lastUpdatedDate !== currentDate) {
          data.isCrossed = false;
          data.arrivalTime = "";
          data.departureTime = "";
          data.lastUpdated = now;  // Update lastUpdated to the current time

          // Save the updated data back to the database
          await data.save();
        }

        // Return the updated or existing fields
        return {
          _id: data._id,
          name: data.name,
          area: data.area,
          isCrossed: data.isCrossed,
          busStopTime: data.busStopTime,
          arrivalTime: data.arrivalTime,
          departureTime: data.departureTime,
        };
      })
    );

    // Send the response with the updated data
    res.json({
      deviceId: deviceId,
      geofences: updatedGeofencingData,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});
router.post("/", jwtAuthMiddleware, async (req, res) => {
  try {
    const { name, area, deviceId, busStopTime } = req.body;
    if (!name || !area || !deviceId) {
      return res.status(400).json({ error: "Name, area, and device ID are required" });
    }

    const findForUnique = await Geofencing.findOne({ name, deviceId });
    console.log(findForUnique,"findForUnique")
    if (findForUnique) {

      return res.status(400).json({ error: 'Same name already exists for this deviceId choose another name' });
      }
    const newGeofencing = new Geofencing({
      name,
      area,
      deviceId,
      busStopTime
    });
    const savedGeofencing = await newGeofencing.save();
    res.status(201).json({ message: "Geofencing area created successfully", geofencing: savedGeofencing });
  } catch (error) {
    console.error("Error creating geofencing area:", error);
    res.status(500).json({ error: "Internal server error" });
  }
})


module.exports = router;
