/**
 * Secure API client that calls Firebase Cloud Functions instead of 
 * exposing the Gemini API key to the client.
 */

// Get the Firebase ID token for authentication
const getAuthToken = async (): Promise<string | null> => {
  // This will be implemented when Firebase Auth is fully integrated
  // For now, return null to allow testing without auth
  try {
    const user = localStorage.getItem('firebaseIdToken');
    return user;
  } catch {
    return null;
  }
};

// Get the Cloud Function URL from environment or use default
const getCloudFunctionUrl = (): string => {
  // In production, this should be your deployed Cloud Function URL
  // Format: https://[REGION]-[PROJECT-ID].cloudfunctions.net/callGemini
  const url = import.meta.env.VITE_CLOUD_FUNCTION_URL;
  
  if (!url) {
    throw new Error(
      'VITE_CLOUD_FUNCTION_URL environment variable is not configured. ' +
      'Please set it to your deployed Cloud Function URL (e.g., https://us-central1-your-project.cloudfunctions.net/callGemini) ' +
      'or for local testing: http://localhost:5001/your-project-id/us-central1/callGemini'
    );
  }
  
  return url;
};

/**
 * Call the Gemini API securely through Firebase Cloud Function
 */
export const secureGenerateContent = async (params: {
  model: string;
  contents: any;
  config?: any;
}): Promise<any> => {
  const authToken = await getAuthToken();
  const url = getCloudFunctionUrl();

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  // Add auth token if available
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP error! status: ${response.status}`);
  }

  return response.json();
};
