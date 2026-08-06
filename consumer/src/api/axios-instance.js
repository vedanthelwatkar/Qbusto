import axios from 'axios';

export const customInstance = (config) => {
  return axios({
    baseURL: process.env.REACT_APP_API_URL,
    ...config,
  });
};