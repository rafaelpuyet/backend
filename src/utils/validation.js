// server/src/utils/validation.js
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const isValidUsername = (username) => /^[a-zA-Z0-9-]{3,20}$/.test(username);
const isValidPhoneNumber = (phone_number) => /^\+569\d{8}$/.test(phone_number);
const isValidPassword = (password) => /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/.test(password);

module.exports = { isValidEmail, isValidUsername, isValidPhoneNumber, isValidPassword };