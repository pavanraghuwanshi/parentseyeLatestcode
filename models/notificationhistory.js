const mongoose = require('mongoose');

const alertsSchema = new mongoose.Schema({

    deviceId: { type: String, },
    // geofenceAlert: { type: Boolean, },
    geofenceName: { type: String, },
    status: { type: String, },

    ignition:{ type: Boolean,},

    branchId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
    schoolId: { type: mongoose.Schema.Types.ObjectId,ref: 'School',},
    childId: {type: mongoose.Schema.Types.ObjectId,ref: 'Child' },
    date: {type:String},
    pickup: {type:Boolean},
    drop: {type:Boolean},
    pickupTime:{ type: String, } ,
    dropTime: { type: String, },

    requestType:{ type: String, },
    requestAlert: { type: String, },
    parentId:{ type: mongoose.Schema.Types.ObjectId, ref: 'Parent'},

    createdAt: { type: Date, default: () => new Date(new Date().getTime() + (5.5 * 60 * 60 * 1000))}

});

const Allalert = mongoose.model('Allalert', alertsSchema);
module.exports = Allalert