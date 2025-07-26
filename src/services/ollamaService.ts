import { securityService } from './securityService';

interface OllamaTextExtractionResult {
  extractedText: string;
  confidence: number;
  pages: PageResult[];
  processingTime: number;
  model: string;
}

interface PageResult {
  pageNumber: number;
  width: number;
  height: number;
  extractedText: string;
  confidence: number;
}

class OllamaService {
  private baseUrl = 'http://localhost:11434';
  private model = 'moondream';

  async extractTextFromDocument(file: File, userId: string): Promise<OllamaTextExtractionResult> {
    const startTime = Date.now();

    try {
      // Log processing start
      securityService.logAction(
        userId,
        'ollama_processing_start',
        'document',
        file.name,
        { 
          fileSize: file.size, 
          fileType: file.type,
          model: this.model,
          endpoint: this.baseUrl
        }
      );

      // Convert file to base64
      const base64Data = await this.fileToBase64(file);

      // Process document with Ollama moondream
      const extractedText = await this.processWithMoondream(base64Data);

      const processingTime = Date.now() - startTime;
      
      // Calculate confidence based on text length and quality indicators
      const confidence = this.calculateConfidence(extractedText);

      const result: OllamaTextExtractionResult = {
        extractedText,
        confidence,
        pages: [{
          pageNumber: 1,
          width: 0, // Not available from moondream
          height: 0, // Not available from moondream
          extractedText,
          confidence
        }],
        processingTime,
        model: this.model
      };

      // Log successful processing
      securityService.logAction(
        userId,
        'ollama_processing_complete',
        'document',
        file.name,
        {
          model: this.model,
          confidence: result.confidence,
          textLength: result.extractedText.length,
          processingTime
        }
      );

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Ollama processing failed';
      
      // Log processing error
      securityService.logAction(
        userId,
        'ollama_processing_error',
        'document',
        file.name,
        { error: errorMessage, model: this.model }
      );

      throw new Error(`Ollama text extraction failed: ${errorMessage}`);
    }
  }

  private async processWithMoondream(base64Data: string): Promise<string> {
    try {
      // Create the prompt for text extraction
      const prompt = "Extract all text content from this image. Include all visible text, maintaining the original structure and formatting as much as possible. Focus on accuracy and completeness.";

      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          prompt: prompt,
          images: [base64Data],
          stream: false,
          options: {
            temperature: 0.1, // Low temperature for more consistent results
            top_p: 0.9,
            top_k: 40
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.response) {
        throw new Error('No response from Ollama model');
      }

      return data.response.trim();

    } catch (error) {
      console.error('Moondream processing failed:', error);
      throw error;
    }
  }

  private calculateConfidence(text: string): number {
    if (!text || text.length === 0) return 0.0;
    
    // Basic confidence calculation based on text characteristics
    let confidence = 0.7; // Base confidence
    
    // Boost confidence based on text length (more text usually means better extraction)
    if (text.length > 100) confidence += 0.1;
    if (text.length > 500) confidence += 0.1;
    
    // Reduce confidence for very short extractions
    if (text.length < 20) confidence -= 0.2;
    
    // Look for structured content indicators
    const hasNumbers = /\d/.test(text);
    const hasLetters = /[a-zA-Z]/.test(text);
    const hasPunctuation = /[.,;:!?]/.test(text);
    
    if (hasNumbers && hasLetters) confidence += 0.05;
    if (hasPunctuation) confidence += 0.05;
    
    // Check for common document elements
    const documentKeywords = ['date', 'name', 'address', 'phone', 'email', 'officer', 'department', 'police'];
    const keywordMatches = documentKeywords.filter(keyword => 
      text.toLowerCase().includes(keyword)
    ).length;
    
    if (keywordMatches > 0) confidence += keywordMatches * 0.02;
    
    // Ensure confidence stays within bounds
    return Math.min(Math.max(confidence, 0.0), 1.0);
  }

  private async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async checkServiceHealth(): Promise<boolean> {
    try {
      // Check if Ollama is running
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET'
      });
      
      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      
      // Check if moondream model is available
      const hasModel = data.models?.some((model: any) => 
        model.name && model.name.includes('moondream')
      );

      return hasModel;
    } catch (error) {
      console.error('Ollama service health check failed:', error);
      return false;
    }
  }

  async ensureModelAvailable(): Promise<boolean> {
    try {
      // First check if model is already available
      const healthCheck = await this.checkServiceHealth();
      if (healthCheck) {
        return true;
      }

      console.log('Moondream model not found, attempting to pull...');
      
      // Try to pull the model if it's not available
      const response = await fetch(`${this.baseUrl}/api/pull`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: this.model
        })
      });

      if (!response.ok) {
        console.error('Failed to pull moondream model');
        return false;
      }

      // Wait a bit for the model to be ready
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      return await this.checkServiceHealth();
    } catch (error) {
      console.error('Error ensuring model availability:', error);
      return false;
    }
  }

  // Get model info for debugging
  async getModelInfo(): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/api/show`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: this.model
        })
      });

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting model info:', error);
      return null;
    }
  }
}

export const ollamaService = new OllamaService();
export type { OllamaTextExtractionResult };