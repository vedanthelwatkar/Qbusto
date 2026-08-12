import axios from 'axios';

/**
 * Format API error responses to user-friendly messages.
 * Never expose stack traces or internal error details.
 */
export function formatApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const message = error.response?.data?.message;

    switch (status) {
      case 400:
        return message || 'Please check your input and try again';
      case 403:
        return 'Access denied or payment verification failed';
      case 404:
        return 'Item not found';
      case 409:
        return message || 'This action cannot be completed right now';
      case 503:
        return 'Service temporarily unavailable. Please try again later';
      case 500:
        return 'Server error. Please try again later';
      default:
        return 'Something went wrong. Please try again';
    }
  }

  if (error instanceof Error) {
    return 'Network error. Please check your internet connection';
  }

  return 'An unexpected error occurred';
}
