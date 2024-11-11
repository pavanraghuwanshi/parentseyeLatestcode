const mongoose = require('mongoose');
const { encrypt, decrypt } = require('./cryptoUtils');

const branchgroupSchema = new mongoose.Schema({
  username: { 
              type: String,
              required: true, 
              unique: true
            },
  password: { 
              type: String,
              required: true, 
  },
  school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null },
  branches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null }],
  
},
{
  timestamps: true
});


branchgroupSchema.pre('save', async function(next) {
  if (this.isModified('password')) {
    this.password = encrypt(this.password);
  }
  next();
});

branchgroupSchema.methods.comparePassword = function(candidatePassword) {
  const decryptedPassword = decrypt(this.password);
  return candidatePassword === decryptedPassword;
};
// Middleware to handle password encryption on `findOneAndUpdate`
branchgroupSchema.pre('findOneAndUpdate', async function(next) {
  const update = this.getUpdate();
  if (update && update.password) {
    update.password = encrypt(update.password);
  }
  next();
});





module.exports = mongoose.model('BranchGroup', branchgroupSchema);
