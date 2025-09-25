const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

(async () => {
  const BASE_URL = 'http://localhost:3000/api';
  const localFilePath = 'C:/Users/bluem/Downloads/Wombat.jpg';

  // Ensure file exists
  if (!fs.existsSync(localFilePath)) {
    console.error('File does not exist:', localFilePath);
    process.exit(1);
  }

  // Register user
  await axios.post(`${BASE_URL}/register`, { name: 'Tony', email: 'tony@gmail.com', password: '123456' }).catch(() => console.log('User exists'));

  // Login
  const login = await axios.post(`${BASE_URL}/login`, { email: 'tony@gmail.com', password: '123456' });
  const token = login.data.token;

  // Upload file
  const form = new FormData();
  form.append('art', fs.createReadStream(localFilePath));
  form.append('forSale', true);
  form.append('price', 300);

  const res = await axios.post(`${BASE_URL}/gallery/upload`, form, {
    headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` },
  });

  console.log('File uploaded:', res.data.art);
})();
