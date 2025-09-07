/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Modality } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const NUM_FRAMES = 9;

// Helper to convert a data URL string to a GoogleGenAI.Part
const dataUrlToGenerativePart = (dataUrl: string): { inlineData: { data: string; mimeType: string; } } => {
    const [header, data] = dataUrl.split(',');
    const mimeType = header.match(/:(.*?);/)?.[1] ?? 'image/png';
    return {
        inlineData: { data, mimeType }
    };
};

const AnimationPlayer = ({ frames }: { frames: string[] }) => {
    const [currentFrameIndex, setCurrentFrameIndex] = useState(0);

    useEffect(() => {
        if (!frames || frames.length === 0) return;

        const interval = setInterval(() => {
            setCurrentFrameIndex((prevIndex) => (prevIndex + 1) % frames.length);
        }, 100); // 100ms for 10 FPS

        return () => clearInterval(interval);
    }, [frames]);

    if (!frames || frames.length === 0) {
        return null;
    }

    return (
        <img
            src={frames[currentFrameIndex]}
            alt="Live animation"
            className="rounded-lg max-w-full h-auto max-h-80 shadow-lg"
        />
    );
};


const App = () => {
    const [prompt, setPrompt] = useState('');
    const [initialImage, setInitialImage] = useState<string | null>(null);
    const [generatedFrames, setGeneratedFrames] = useState<(string | null)[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState(0);
    const [isCyclic, setIsCyclic] = useState(false);

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setGeneratedFrames([]);
            setError(null);
            setInitialImage(null);

            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const MAX_DIMENSION = 512;
                    let { width, height } = img;

                    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                        if (width > height) {
                            height = Math.round(height * (MAX_DIMENSION / width));
                            width = MAX_DIMENSION;
                        } else {
                            width = Math.round(width * (MAX_DIMENSION / height));
                            height = MAX_DIMENSION;
                        }
                    }
                    
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.drawImage(img, 0, 0, width, height);
                        const dataUrl = canvas.toDataURL('image/png');
                        setInitialImage(dataUrl);
                    } else {
                        setError("Could not process image.");
                    }
                };
                img.onerror = () => {
                    setError("Could not load the selected image file.");
                };
                if (event.target?.result) {
                    img.src = event.target.result as string;
                }
            };
            reader.onerror = () => {
                setError("Could not read the selected file.");
            };
            reader.readAsDataURL(file);
        }
    };

    const generateAnimation = async () => {
        if (!prompt || !initialImage) {
            setError("Please provide both an image and a prompt.");
            return;
        }

        setIsLoading(true);
        setError(null);
        setProgress(0);

        const allFramesData = new Array<string | null>(NUM_FRAMES).fill(null);
        setGeneratedFrames([...allFramesData]);

        // Helper to generate a single frame between a start and end point
        const generateSingleFrame = async (startIndex: number, endIndex: number) => {
            const midIndex = Math.floor((startIndex + endIndex) / 2);

            if (!allFramesData[startIndex] || !allFramesData[endIndex]) {
                console.warn(`Skipping frame ${midIndex} due to missing boundary images.`);
                return null;
            }

            try {
                const startFramePart = dataUrlToGenerativePart(allFramesData[startIndex]!);
                const endFramePart = dataUrlToGenerativePart(allFramesData[endIndex]!);

                const midFrameResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash-image-preview',
                    contents: {
                        parts: [
                            startFramePart,
                            endFramePart,
                            { text: `These are the start and end frames of a short animation sequence. The full animation is described as: "${prompt}". Generate the single frame that should appear exactly in the middle of these two. Ensure the background is transparent.` },
                        ],
                    },
                    config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
                });

                const midImagePart = midFrameResponse.candidates?.[0]?.content.parts.find(p => 'inlineData' in p);
                if (midImagePart && 'inlineData' in midImagePart && midImagePart.inlineData.data) {
                    return {
                        index: midIndex,
                        frame: `data:${midImagePart.inlineData.mimeType};base64,${midImagePart.inlineData.data}`
                    };
                }
                console.warn(`Could not extract image data for frame index ${midIndex}.`);
                return null;
            } catch (err) {
                console.error(`Failed to generate frame at index ${midIndex}:`, err);
                return null;
            }
        };

        try {
            // 1. Generate a "clean" first frame from the user upload for consistency.
            const initialFramePart = dataUrlToGenerativePart(initialImage);
            const firstFrameResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image-preview',
                contents: {
                    parts: [
                        initialFramePart,
                        { text: `Redraw this character image exactly as it is. Crucially, ensure it has a perfectly transparent background. This will be the starting frame of an animation.` },
                    ],
                },
                config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
            });
            const firstImagePart = firstFrameResponse.candidates?.[0]?.content.parts.find(p => 'inlineData' in p);
            if (!firstImagePart || !('inlineData' in firstImagePart) || !firstImagePart.inlineData.data) {
                throw new Error("API did not return the initial frame.");
            }
            const processedInitialImage = `data:${firstImagePart.inlineData.mimeType};base64,${firstImagePart.inlineData.data}`;
            allFramesData[0] = processedInitialImage;
            setGeneratedFrames([...allFramesData]);
            setProgress(1);


            // 2. Determine and generate the last frame
            if (isCyclic) {
                allFramesData[NUM_FRAMES - 1] = processedInitialImage;
                setProgress(prev => prev + 1); // Account for this step in progress
            } else {
                const lastFrameResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash-image-preview',
                    contents: {
                        parts: [
                            dataUrlToGenerativePart(processedInitialImage),
                            { text: `This is the first frame of an animation. The full animation is described as: "${prompt}". Generate ONLY the final frame of this animation. Ensure the background is transparent.` },
                        ],
                    },
                    config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
                });

                const lastImagePart = lastFrameResponse.candidates?.[0]?.content.parts.find(p => 'inlineData' in p);
                if (!lastImagePart || !('inlineData' in lastImagePart) || !lastImagePart.inlineData.data) {
                    throw new Error("API did not return the last frame.");
                }
                const lastFrameBase64 = `data:${lastImagePart.inlineData.mimeType};base64,${lastImagePart.inlineData.data}`;
                allFramesData[NUM_FRAMES - 1] = lastFrameBase64;
                setProgress(prev => prev + 1);
            }
            setGeneratedFrames([...allFramesData]);


            // 3. Iteratively generate in-between frames level by level
            let rangesToProcess: [number, number][] = [[0, NUM_FRAMES - 1]];
            while (rangesToProcess.some(([start, end]) => end - start > 1)) {
                const promises = rangesToProcess
                    .filter(([start, end]) => end - start > 1)
                    .map(([start, end]) => generateSingleFrame(start, end));

                const results = await Promise.all(promises);
                
                results.forEach(result => {
                    if (result) {
                        allFramesData[result.index] = result.frame;
                    }
                });

                setProgress(prev => prev + results.filter(Boolean).length);
                setGeneratedFrames([...allFramesData]);
                
                const nextRanges: [number, number][] = [];
                rangesToProcess.forEach(([start, end]) => {
                    const mid = Math.floor((start + end) / 2);
                    nextRanges.push([start, mid]);
                    nextRanges.push([mid, end]);
                });
                rangesToProcess = nextRanges;
            }

            const finalFrames = allFramesData.filter((frame): frame is string => frame !== null);
            if (finalFrames.length < 2) {
                throw new Error("Not enough frames were generated to create an animation.");
            }
            
            setProgress(NUM_FRAMES);

        } catch (err) {
            console.error(err);
            const message = err instanceof Error ? err.message : "An unknown error occurred.";
            setError("Failed to generate animation. " + message);
        } finally {
            setIsLoading(false);
        }
    };
    
    const isGenerationComplete = !isLoading && generatedFrames.some(f => f !== null);

    return (
        <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center p-4 sm:p-6 md:p-10">
            <header className="w-full max-w-5xl text-center mb-8">
                <h1 className="text-4xl sm:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600">
                    AnimaBanana
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
                                    <img src={initialImage} alt="Uploaded preview" className="mx-auto h-32 w-32 object-contain rounded-lg" />
                                ) : (
                                    <svg className="mx-auto h-12 w-12 text-gray-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                        <path fillRule="evenodd" d="M1.5 6a2.25 2.25 0 012.25-2.25h16.5A2.25 2.25 0 0122.5 6v12a2.25 2.25 0 01-2.25 2.25H3.75A2.25 2.25 0 011.5 18V6zM3 16.06V18c0 .414.336.75.75.75h16.5A.75.75 0 0021 18v-1.94l-2.69-2.689a1.5 1.5 0 00-2.12 0l-.88.879.97.97a.75.75 0 11-1.06 1.06l-5.16-5.159a1.5 1.5 0 00-2.12 0L3 16.061zm10.125-7.81a1.125 1.125 0 112.25 0 1.125 1.125 0 01-2.25 0z" clipRule="evenodd" />
                                    </svg>
                                )}
                                <div className="mt-4 flex text-sm leading-6 text-gray-400">
                                    <label htmlFor="file-upload" className="relative cursor-pointer rounded-md font-semibold text-purple-400 focus-within:outline-none focus-within:ring-2 focus-within:ring-purple-600 focus-within:ring-offset-2 focus-within:ring-offset-gray-900 hover:text-purple-300">
                                        <span>Upload a file</span>
                                        <input id="file-upload" name="file-upload" type="file" className="sr-only" accept="image/png, image/jpeg, image/gif, image/webp" onChange={handleImageChange} />
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
                    <div className="flex items-center">
                        <input
                            id="cyclic-checkbox"
                            type="checkbox"
                            checked={isCyclic}
                            onChange={(e) => setIsCyclic(e.target.checked)}
                            className="h-4 w-4 rounded border-gray-500 bg-gray-700 text-purple-600 focus:ring-purple-600 focus:ring-offset-gray-800"
                        />
                        <label htmlFor="cyclic-checkbox" className="ml-3 block text-sm font-medium text-gray-300">
                            Create cyclic animation (loops seamlessly)
                        </label>
                    </div>
                    <button
                        onClick={generateAnimation}
                        disabled={isLoading || !initialImage || !prompt}
                        className="w-full rounded-md bg-purple-600 px-4 py-3 text-base font-semibold text-white shadow-sm hover:bg-purple-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                        {isLoading ? `Generating Frame ${progress}/${NUM_FRAMES}...` : 'Generate Frames'}
                    </button>
                    {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
                </div>
                
                {/* Output */}
                <div className="flex flex-col items-center justify-center bg-black/20 rounded-lg p-4 min-h-[300px]">
                    {isLoading || isGenerationComplete ? (
                        <div className="w-full">
                            {isLoading && (
                                <div className="relative pt-1">
                                    <div className="overflow-hidden h-4 mb-4 text-xs flex rounded-full bg-purple-900">
                                        <div style={{ width: `${(progress / NUM_FRAMES) * 100}%` }} className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"></div>
                                    </div>
                                </div>
                            )}
                            {isGenerationComplete && <h3 className="text-xl font-semibold mb-4 text-center">Generated Frames</h3>}
                            <div className="grid grid-cols-3 gap-2 mt-4">
                                {generatedFrames.map((frame, index) => (
                                    frame ? 
                                    <img key={index} src={frame} alt={`Frame ${index + 1}`} className="w-full aspect-square object-contain rounded-md bg-gray-700" />
                                    :
                                    <div key={index} className="w-full aspect-square rounded-md bg-gray-700 animate-pulse"></div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="text-center text-gray-500">
                            <p>Your generated frames will appear here.</p>
                        </div>
                    )}
                </div>
            </main>

            {isGenerationComplete && (
                 <section className="w-full max-w-5xl mt-8 bg-gray-800 p-8 rounded-2xl shadow-2xl text-center">
                    <h2 className="text-2xl font-bold mb-4 text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600">
                        Animation Preview
                    </h2>
                    <div className="flex justify-center">
                        <AnimationPlayer frames={generatedFrames.filter((f): f is string => f !== null)} />
                    </div>
                </section>
            )}

        </div>
    );
};

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}