const jwt = require('jsonwebtoken');
const SuperAdmin = require('../model/superAdminSchema');

const authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'Authorization token missing or invalid' });
        }

        const token = authHeader.split(' ')[1];

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (!decoded?.id || decoded.role !== 'super_admin') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const superAdmin = await SuperAdmin.findById(decoded.id).select('-password');

        if (!superAdmin) {
            return res.status(401).json({ message: 'Unauthorized: user not found' });
        }

        req.user = {
            id: superAdmin._id,
            fullName: superAdmin.fullName,
            email: superAdmin.email,
            phoneNumber: superAdmin.phoneNumber,
            role: decoded.role,
        };

        next();
        
    } catch (error) {
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
};

module.exports = authMiddleware;
