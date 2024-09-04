const mongoose = require('mongoose');
const { encrypt, decrypt } = require('./cryptoUtils'); 

const branchSchema = new mongoose.Schema({
  branch: {
    type: String,
    required: true
  },
  schoolId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'School',
    required: true
  },
 mobileNo:{
    type: Number,
    required: true
  },
  username:{
    type: String,
    required: true,
    unique:true
  },
  password:{
    type: String,
    required: true
  },
  email:{
    type: String,
    required: true
  }
});


branchSchema.pre('save', async function(next) {
  if (this.isModified('password')) {
    this.password = encrypt(this.password);
  }
  next();
});

branchSchema.methods.comparePassword = function(candidatePassword) {
  const decryptedPassword = decrypt(this.password);
  return candidatePassword === decryptedPassword;
};


module.exports = mongoose.model('Branch', branchSchema);
