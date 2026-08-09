import axios from 'axios';

export const customInstance = (config) => {
  return axios({
    baseURL: import.meta.env.VITE_API_URL,
    ...config,
  });
};