/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Modality } from '@google/genai';
import GIF from 'gif-encoder-2';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const NUM_FRAMES = 10;

// Helper to convert file to base64
// FIX: Added type for file parameter and return type, and cast reader.result to string to resolve error on split.
const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string; } }> => {
  const base64EncodedDataPromise = new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(file);
  });
  return {
    inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
  };
};

const App = () => {
    const [prompt, setPrompt] = useState('');
    const [initialImage, setInitialImage] = useState<{ file: File, url: string } | null>(null);
    const [generatedFrames, setGeneratedFrames] = useState<string[]>([]);
    const [finalGif, setFinalGif] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState(0);

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setFinalGif(null);
            setGeneratedFrames([]);
            setError(null);
            setInitialImage({
                file: file,
                url: URL.createObjectURL(file),
            });
        }
    };

    const createGif = useCallback(async (frames: string[]) => {
        if (frames.length === 0) return;

        const imagePromises = frames.map(frameData => {
            return new Promise<HTMLImageElement>((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = frameData;
            });
        });

        const images = await Promise.all(imagePromises);
        const { width, height } = images[0];

        const encoder = GIF.createEncoder(width, height);
        encoder.start();
        encoder.setRepeat(0); // 0 for repeat, -1 for no-repeat
        encoder.setDelay(150); // ms

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        for (const img of images) {
            ctx.drawImage(img, 0, 0, width, height);
            encoder.addFrame(ctx);
        }

        encoder.finish();
        const buffer = encoder.out.getData();
        const blob = new Blob([buffer], { type: 'image/gif' });
        setFinalGif(URL.createObjectURL(blob));
    }, []);

    const generateAnimation = async () => {
        if (!prompt || !initialImage) {
            setError("Please provide both an image and a prompt.");
            return;
        }

        setIsLoading(true);
        setError(null);
        setFinalGif(null);
        setGeneratedFrames([initialImage.url]);
        setProgress(0);

        try {
            let currentFramePart = await fileToGenerativePart(initialImage.file);
            const allFramesData = [initialImage.url];

            for (let i = 0; i < NUM_FRAMES - 1; i++) {
                setProgress(i + 1);
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash-image-preview',
                    contents: {
                        parts: [
                            currentFramePart,
                            { text: `${prompt} This is frame ${i + 2} of ${NUM_FRAMES}.` },
                        ],
                    },
                    config: {
                        responseModalities: [Modality.IMAGE, Modality.TEXT],
                    },
                });

                // FIX: Safely find the image part from the response and ensure it has data.
                const imagePart = response.candidates?.[0]?.content.parts.find(p => 'inlineData' in p);
                
                // FIX: Added checks to ensure imagePart and its data are valid before proceeding, which also acts as a type guard.
                if (!imagePart || !('inlineData' in imagePart) || !imagePart.inlineData.data) {
                    throw new Error("API did not return an image for frame " + (i + 1));
                }
                
                // FIX: Re-construct the part object to ensure type compatibility for the next iteration.
                currentFramePart = { 
                    inlineData: { 
                        data: imagePart.inlineData.data, 
                        mimeType: imagePart.inlineData.mimeType 
                    } 
                };
                const frameBase64 = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
                allFramesData.push(frameBase64);
                setGeneratedFrames([...allFramesData]);
            }

            setProgress(NUM_FRAMES);
            await createGif(allFramesData);

        } catch (err) {
            console.error(err);
            const message = err instanceof Error ? err.message : "An unknown error occurred.";
            setError("Failed to generate animation. " + message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-4 sm:p-6 md:p-10">
            <header className="w-full max-w-5xl text-center mb-8">
                <h1 className="text-4xl sm:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600">
                    Cartoon GIF Animator
                </h1>
                <p className="text-gray-400 mt-2">Bring your characters to life with AI</p>
            </header>

            <main className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-8 bg-gray-800 p-8 rounded-2xl shadow-2xl">
                {/* Inputs */}
                <div className="flex flex-col gap-6">
                    <div>
                        <label htmlFor="image-upload" className="block text-lg font-medium text-gray-300 mb-2">1. Upload Character Image</label>
                        <div className="mt-2 flex justify-center rounded-lg border border-dashed border-gray-500 px-6 py-10 hover:border-purple-400 transition-colors">
                            <div className="text-center">
                                {initialImage ? (
                                    <img src={initialImage.url} alt="Uploaded preview" className="mx-auto h-32 w-32 object-cover rounded-lg" />
                                ) : (
                                    <svg className="mx-auto h-12 w-12 text-gray-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                        <path fillRule="evenodd" d="M1.5 6a2.25 2.25 0 012.25-2.25h16.5A2.25 2.25 0 0122.5 6v12a2.25 2.25 0 01-2.25 2.25H3.75A2.25 2.25 0 011.5 18V6zM3 16.06V18c0 .414.336.75.75.75h16.5A.75.75 0 0021 18v-1.94l-2.69-2.689a1.5 1.5 0 00-2.12 0l-.88.879.97.97a.75.75 0 11-1.06 1.06l-5.16-5.159a1.5 1.5 0 00-2.12 0L3 16.061zm10.125-7.81a1.125 1.125 0 112.25 0 1.125 1.125 0 01-2.25 0z" clipRule="evenodd" />
                                    </svg>
                                )}
                                <div className="mt-4 flex text-sm leading-6 text-gray-400">
                                    <label htmlFor="file-upload" className="relative cursor-pointer rounded-md font-semibold text-purple-400 focus-within:outline-none focus-within:ring-2 focus-within:ring-purple-600 focus-within:ring-offset-2 focus-within:ring-offset-gray-900 hover:text-purple-300">
                                        <span>Upload a file</span>
                                        <input id="file-upload" name="file-upload" type="file" className="sr-only" accept="image/*" onChange={handleImageChange} />
                                    </label>
                                    <p className="pl-1">or drag and drop</p>
                                </div>
                                <p className="text-xs leading-5 text-gray-500">PNG, JPG, GIF up to 10MB</p>
                            </div>
                        </div>
                    </div>
                    <div>
                        <label htmlFor="prompt" className="block text-lg font-medium text-gray-300 mb-2">2. Describe Animation</label>
                        <textarea
                            id="prompt"
                            rows={3}
                            className="block w-full rounded-md border-0 bg-white/5 py-2 px-3 text-white shadow-sm ring-1 ring-inset ring-gray-600 focus:ring-2 focus:ring-inset focus:ring-purple-500 sm:text-sm sm:leading-6 placeholder:text-gray-500"
                            placeholder="e.g., waving its hand, jumping up and down, looking surprised"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                        />
                    </div>
                    <button
                        onClick={generateAnimation}
                        disabled={isLoading || !initialImage || !prompt}
                        className="w-full rounded-md bg-purple-600 px-4 py-3 text-base font-semibold text-white shadow-sm hover:bg-purple-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                        {isLoading ? `Generating Frame ${progress}/${NUM_FRAMES}...` : 'Generate GIF'}
                    </button>
                    {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
                </div>
                
                {/* Output */}
                <div className="flex flex-col items-center justify-center bg-black/20 rounded-lg p-4 min-h-[300px]">
                    {finalGif ? (
                        <div className="text-center">
                            <h3 className="text-xl font-semibold mb-4">Your Animated GIF!</h3>
                            <img src={finalGif} alt="Generated animation" className="rounded-lg max-w-full h-auto max-h-80 shadow-lg" />
                            <a href={finalGif} download="animation.gif" className="mt-6 inline-block rounded-md bg-green-600 px-4 py-2 text-base font-semibold text-white shadow-sm hover:bg-green-500">
                                Download GIF
                            </a>
                        </div>
                    ) : isLoading ? (
                        <div className="w-full">
                            <div className="relative pt-1">
                                <div className="overflow-hidden h-4 mb-4 text-xs flex rounded-full bg-purple-900">
                                    <div style={{ width: `${(progress / NUM_FRAMES) * 100}%` }} className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"></div>
                                </div>
                            </div>
                            <div className="grid grid-cols-5 gap-2 mt-4">
                                {generatedFrames.map((frame, index) => (
                                    <img key={index} src={frame} alt={`Frame ${index + 1}`} className="w-full aspect-square object-cover rounded-md bg-gray-700" />
                                ))}
                                {Array.from({ length: NUM_FRAMES - generatedFrames.length }).map((_, index) => (
                                    <div key={index} className="w-full aspect-square rounded-md bg-gray-700 animate-pulse"></div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="text-center text-gray-500">
                            <p>Your generated GIF will appear here.</p>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
};

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}
