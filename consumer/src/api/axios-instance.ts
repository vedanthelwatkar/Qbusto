import axios from 'axios';
import type { AxiosRequestConfig, AxiosPromise } from 'axios';

export const customInstance = <T>(config: AxiosRequestConfig): AxiosPromise<T> => {
  return axios({
    baseURL: import.meta.env.VITE_API_URL,
    ...config,
  });
};
