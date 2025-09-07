/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Modality, Type } from '@google/genai';
import JSZip from 'jszip';


const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const NUM_FRAMES = 9;

// Pricing constants based on published Google AI prices as of mid-2024.
// These are for estimation purposes only.
const GEMINI_FLASH_INPUT_PRICE_PER_MILLION_TOKENS = 0.35;
const GEMINI_FLASH_OUTPUT_PRICE_PER_MILLION_TOKENS = 0.70;
const IMAGE_GENERATION_PRICE_PER_IMAGE = 0.018; 


// Helper to convert a data URL string to a GoogleGenAI.Part
const dataUrlToGenerativePart = (dataUrl: string): { inlineData: { data: string; mimeType: string; } } => {
    const [header, data] = dataUrl.split(',');
    const mimeType = header.match(/:(.*?);/)?.[1] ?? 'image/png';
    return {
        inlineData: { data, mimeType }
    };
};

// Helper to check if a canvas has a transparent background by checking corner pixels
const checkTransparency = (canvas: HTMLCanvasElement): boolean => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;

    const { width, height } = canvas;
    if (width === 0 || height === 0) return false;

    const pixelDataTL = ctx.getImageData(0, 0, 1, 1).data;
    const pixelDataTR = ctx.getImageData(width - 1, 0, 1, 1).data;
    const pixelDataBL = ctx.getImageData(0, height - 1, 1, 1).data;
    const pixelDataBR = ctx.getImageData(width - 1, height - 1, 1, 1).data;

    // Check if alpha channel (4th byte) is 0 for all corners
    return pixelDataTL[3] === 0 && pixelDataTR[3] === 0 && pixelDataBL[3] === 0 && pixelDataBR[3] === 0;
};

// Helper to compare two pose objects and identify changed parts
const diffPoses = (poseA: Record<string, string>, poseB: Record<string, string>): { changedParts: string[]; unchangedParts: string[] } => {
    const changedParts: string[] = [];
    const unchangedParts: string[] = [];
    if (!poseA || !poseB) return { changedParts, unchangedParts };

    const allKeys = new Set([...Object.keys(poseA), ...Object.keys(poseB)]);

    for (const key of allKeys) {
        // We only care about the actual pose keys, not metadata
        if (key === 'notes') continue; 
        
        if (poseA[key] !== poseB[key]) {
            changedParts.push(key);
        } else {
            unchangedParts.push(key);
        }
    }
    return { changedParts, unchangedParts };
};


const AnimationPlayer = ({ frames, fps }: { frames: (string | null)[]; fps: number; }) => {
    const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(true);

    useEffect(() => {
        if (!isPlaying) return;

        const intervalDuration = 1000 / fps;
        const interval = setInterval(() => {
            setCurrentFrameIndex((prevIndex) => (prevIndex + 1) % NUM_FRAMES);
        }, intervalDuration);

        return () => clearInterval(interval);
    }, [fps, isPlaying]);

    // For the current index, find the last available frame by looking backwards
    let imageToDisplay: string | null = null;
    for (let i = currentFrameIndex; i >= 0; i--) {
        if (frames[i]) {
            imageToDisplay = frames[i];
            break;
        }
    }
    // If we didn't find one going back, try finding the first available one from the start
    if (!imageToDisplay) {
        for (let i = 0; i < frames.length; i++) {
            if (frames[i]) {
                imageToDisplay = frames[i];
                break;
            }
        }
    }
    
    const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setIsPlaying(false); // Pause on scrub
        setCurrentFrameIndex(Number(e.target.value));
    };

    const togglePlayPause = () => {
        setIsPlaying(!isPlaying);
    };


    if (!imageToDisplay) {
        return null; // Don't render if no frames are available yet up to this point
    }

    return (
        <div className="w-full flex flex-col items-center gap-4">
            <img
                src={imageToDisplay}
                alt="Live animation"
                className="rounded-lg max-w-full h-auto max-h-80 shadow-lg"
            />
             <div className="w-full max-w-sm flex items-center gap-3">
                <button
                    onClick={togglePlayPause}
                    className="p-2 rounded-full bg-gray-700 hover:bg-gray-600 text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-pink-500"
                    aria-label={isPlaying ? 'Pause animation' : 'Play animation'}
                >
                    {isPlaying ? (
                        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 00-1 1v2a1 1 0 102 0V9a1 1 0 00-1-1zm5 0a1 1 0 00-1 1v2a1 1 0 102 0V9a1 1 0 00-1-1z" clipRule="evenodd"></path></svg>
                    ) : (
                        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd"></path></svg>
                    )}
                </button>
                 <input
                    type="range"
                    min="0"
                    max={NUM_FRAMES - 1}
                    value={currentFrameIndex}
                    onChange={handleSliderChange}
                    className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-pink-500"
                    aria-label="Frame scrubber"
                />
                <span className="text-sm font-mono w-16 text-left text-gray-400">{currentFrameIndex + 1} / {NUM_FRAMES}</span>
            </div>
        </div>
    );
};


const App = () => {
    const [prompt, setPrompt] = useState('');
    const [initialImage, setInitialImage] = useState<string | null>(null);
    const [initialImageHasTransparency, setInitialImageHasTransparency] = useState(false);
    const [generatedFrames, setGeneratedFrames] = useState<(string | null)[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState(0);
    const [isCyclic, setIsCyclic] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('');
    const [estimatedCost, setEstimatedCost] = useState(0);
    const [fps, setFps] = useState(5);

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setGeneratedFrames([]);
            setError(null);
            setInitialImage(null);
            setInitialImageHasTransparency(false);

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
                    const ctx = canvas.getContext('2d', { willReadFrequently: true });
                    if (ctx) {
                        ctx.drawImage(img, 0, 0, width, height);
                        const dataUrl = canvas.toDataURL('image/png');
                        setInitialImage(dataUrl);
                        setInitialImageHasTransparency(checkTransparency(canvas));
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
        setEstimatedCost(0);
        
        const totalSteps = NUM_FRAMES + 1; // 1 for planning, NUM_FRAMES for image generation

        const allFramesData = new Array<string | null>(NUM_FRAMES).fill(null);
        setGeneratedFrames([...allFramesData]);
        
        const backgroundInstruction = initialImageHasTransparency
            ? "The background MUST be perfectly transparent."
            : "The background of the generated image MUST perfectly match the background of the provided keyframes. Do not alter the background.";


        // Helper to generate a single frame between a start and end point
        const generateSingleFrame = async (startIndex: number, endIndex: number, framePrompts: Record<string, string>[], originalImage: string) => {
            const midIndex = Math.floor((startIndex + endIndex) / 2);

            if (!allFramesData[startIndex] || !allFramesData[endIndex] || !framePrompts[startIndex] || !framePrompts[midIndex]) {
                console.warn(`Skipping frame ${midIndex} due to missing boundary data.`);
                return null;
            }

            try {
                const originalImagePart = dataUrlToGenerativePart(originalImage);
                const startFramePart = dataUrlToGenerativePart(allFramesData[startIndex]!);
                const endFramePart = dataUrlToGenerativePart(allFramesData[endIndex]!);
                
                // Compare the target pose with the start pose to find what's different
                const { changedParts, unchangedParts } = diffPoses(framePrompts[startIndex], framePrompts[midIndex]);

                const changeDescription = changedParts.length > 0 
                    ? changedParts.map(part => `  - ${part}: ${framePrompts[midIndex][part]}`).join('\n')
                    : "  - No direct pose changes, but follow the 'notes' for this frame: " + framePrompts[midIndex]['notes'];
                
                const unchangedDescription = unchangedParts.length > 0 ? unchangedParts.join(', ') : 'All other parts';


                const refinedPrompt = `
You are an expert animator executing a single, precise instruction for a motion photoshoot.

**REFERENCE IMAGES:**
1.  **Original Image (Style Lock):** This is the "ground truth" for the character's appearance. The final output's art style, colors, and proportions MUST match this image with 100% fidelity.
2.  **Start Frame:** This is the frame you will be modifying.
3.  **End Frame:** This provides context for the end of the motion.

**PRIMARY GOAL:** Your task is to perform a minimal, surgical modification to the "Start Frame".

**INSTRUCTIONS FOR THIS FRAME:**

1.  **STEP 1: REPLICATE:** Start by creating a perfect, pixel-for-pixel copy of the "Start Frame".
2.  **STEP 2: MODIFY:** Apply ONLY the following changes. DO NOT TOUCH any other part of the character.
    -   **UNCHANGED PARTS:** The following parts MUST remain IDENTICAL to the "Start Frame": **${unchangedDescription}**
    -   **CHANGED PARTS:** Modify ONLY these parts to match their new description:
${changeDescription}

**CRUCIAL RULES:**
- **MINIMAL CHANGE:** This is your most important rule. Do not get creative. Do not reinterpret the character. Your job is to execute a tiny, specific change.
- **STYLE FIDELITY:** The final image must look exactly like the "Original Image" in terms of style.
- **Background:** ${backgroundInstruction}
`;


                const midFrameResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash-image-preview',
                    contents: {
                        parts: [
                            originalImagePart, // Style Lock
                            startFramePart,   // Frame to modify
                            endFramePart,     // Context
                            { text: refinedPrompt },
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
            // 1. Generate a full script of frame-by-frame prompts
            setLoadingMessage('Generating animation plan...');
            const isCyclicText = isCyclic ? "The animation should loop seamlessly, so the last frame should lead smoothly back into the first." : "The animation has a distinct start and end.";
            const plannerPrompt = `
You are a master animator and puppeteer acting as a meticulous director for a motion photoshoot. A user wants to create a ${NUM_FRAMES}-frame animation.
User's request: "${prompt}"
${isCyclicText}

Your task is to create a detailed, frame-by-frame animation plan. This plan will define the precise pose of a character for ${NUM_FRAMES} frames.
Focus *only* on the character's pose, position, and expression for each specific frame.

**CRITICAL RULE:** The character's core appearance, art style, colors, proportions, and accessories (like sunglasses) MUST remain consistent across all frames. DO NOT change the facial expression unless the user's prompt *specifically* requests it (e.g., "looking surprised"). You are directing a model, not redesigning a character.

Output your response as a JSON array of objects. Each object represents one frame and must contain the following keys: "notes", "head", "torso", "left_arm", "right_arm", "left_leg", "right_leg", "facial_expression".
The values should be detailed string descriptions of the position and rotation of each body part. Be extremely specific to ensure a smooth, logical, and believable progression of movement. The array must contain exactly ${NUM_FRAMES} elements.
`;
            const promptGenResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: plannerPrompt,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                notes: { type: Type.STRING, description: "A brief summary of the action in this frame." },
                                head: { type: Type.STRING, description: "Position and orientation of the head." },
                                torso: { type: Type.STRING, description: "Position and orientation of the torso." },
                                left_arm: { type: Type.STRING, description: "Position, rotation, and gesture of the left arm and hand." },
                                right_arm: { type: Type.STRING, description: "Position, rotation, and gesture of the right arm and hand." },
                                left_leg: { type: Type.STRING, description: "Position and orientation of the left leg and foot." },
                                right_leg: { type: Type.STRING, description: "Position and orientation of the right leg and foot." },
                                facial_expression: { type: Type.STRING, description: "The character's facial expression, including eyes and mouth." },
                            },
                             required: ["notes", "head", "torso", "left_arm", "right_arm", "left_leg", "right_leg", "facial_expression"]
                        },
                    },
                },
            });

            const usage = promptGenResponse.usageMetadata;
            if (usage) {
                const inputCost = (usage.promptTokenCount / 1_000_000) * GEMINI_FLASH_INPUT_PRICE_PER_MILLION_TOKENS;
                const outputCost = (usage.candidatesTokenCount / 1_000_000) * GEMINI_FLASH_OUTPUT_PRICE_PER_MILLION_TOKENS;
                setEstimatedCost(prev => prev + inputCost + outputCost);
            }

            const generatedPrompts = JSON.parse(promptGenResponse.text);

            if (!Array.isArray(generatedPrompts) || generatedPrompts.length !== NUM_FRAMES || !generatedPrompts.every(p => typeof p === 'object' && p !== null)) {
                throw new Error('The AI failed to generate a valid animation plan. Please try a different prompt.');
            }
            const framePrompts = generatedPrompts as Record<string, string>[];
            setProgress(1);
            setLoadingMessage('Generating frames...');


            // 2. Generate frames based on the script
            // 2a. Generate a "clean" first frame from the user upload for consistency.
            const initialFramePart = dataUrlToGenerativePart(initialImage);
            const firstFrameResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image-preview',
                contents: {
                    parts: [
                        initialFramePart,
                        { text: `Redraw this character to be used as the clean first frame of an animation. Replicate the character's appearance, art style, colors, and proportions with 100% fidelity. Your task is to place the character into this precise pose: \`\`\`json\n${JSON.stringify(framePrompts[0], null, 2)}\n\`\`\` Follow this background instruction: "${backgroundInstruction}". Do not alter the character's design in any way.` },
                    ],
                },
                config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
            });
            const firstImagePart = firstFrameResponse.candidates?.[0]?.content.parts.find(p => 'inlineData' in p);
            if (!firstImagePart || !('inlineData' in firstImagePart) || !firstImagePart.inlineData.data) {
                throw new Error("API did not return the initial frame.");
            }
            setEstimatedCost(prev => prev + IMAGE_GENERATION_PRICE_PER_IMAGE);
            const processedInitialImage = `data:${firstImagePart.inlineData.mimeType};base64,${firstImagePart.inlineData.data}`;
            allFramesData[0] = processedInitialImage;
            setGeneratedFrames([...allFramesData]);
            setProgress(prev => prev + 1);


            // 2b. Determine and generate the last frame
            if (isCyclic) {
                allFramesData[NUM_FRAMES - 1] = processedInitialImage;
                setProgress(prev => prev + 1);
            } else {
                const lastFrameResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash-image-preview',
                    contents: {
                        parts: [
                            dataUrlToGenerativePart(initialImage), // Original Image (Style Lock)
                            dataUrlToGenerativePart(processedInitialImage), // Start Frame (Pose Reference)
                            { text: `You are generating the final frame of an animation. Use the "Original Image" (the first image provided) as the absolute ground truth for art style, colors, and proportions. Use the "Start Frame" (the second image provided) as the base for modification. Your task is to modify the "Start Frame" to match this new pose description with perfect style consistency: \`\`\`json\n${JSON.stringify(framePrompts[NUM_FRAMES - 1], null, 2)}\n\`\`\` Follow this background instruction: "${backgroundInstruction}". Do not change any part of the character not specified in the pose description.` },
                        ],
                    },
                    config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
                });
                
                const lastImagePart = lastFrameResponse.candidates?.[0]?.content.parts.find(p => 'inlineData' in p);
                if (!lastImagePart || !('inlineData' in lastImagePart) || !lastImagePart.inlineData.data) {
                    throw new Error("API did not return the last frame.");
                }
                setEstimatedCost(prev => prev + IMAGE_GENERATION_PRICE_PER_IMAGE);
                const lastFrameBase64 = `data:${lastImagePart.inlineData.mimeType};base64,${lastImagePart.inlineData.data}`;
                allFramesData[NUM_FRAMES - 1] = lastFrameBase64;
                setProgress(prev => prev + 1);
            }
            setGeneratedFrames([...allFramesData]);


            // 2c. Iteratively generate in-between frames level by level
            let rangesToProcess: [number, number][] = [[0, NUM_FRAMES - 1]];
            while (rangesToProcess.some(([start, end]) => end - start > 1)) {
                const promises = rangesToProcess
                    .filter(([start, end]) => end - start > 1)
                    .map(([start, end]) => generateSingleFrame(start, end, framePrompts, initialImage));

                const results = await Promise.all(promises);
                
                const successfulGenerations = results.filter(Boolean).length;
                if (successfulGenerations > 0) {
                     setEstimatedCost(prev => prev + (successfulGenerations * IMAGE_GENERATION_PRICE_PER_IMAGE));
                }

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
            
            setProgress(totalSteps);

        } catch (err) {
            console.error(err);
            const message = err instanceof Error ? err.message : "An unknown error occurred.";
            setError("Failed to generate animation. " + message);
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    };

    const handleDownload = async () => {
        const zip = new JSZip();
        let frameCount = 0;
    
        generatedFrames.forEach((frameDataUrl, index) => {
            if (frameDataUrl) {
                frameCount++;
                const base64Data = frameDataUrl.split(',')[1];
                const paddedIndex = String(index).padStart(2, '0');
                zip.file(`frame_${paddedIndex}.png`, base64Data, { base64: true });
            }
        });
    
        if (frameCount > 0) {
            try {
                const content = await zip.generateAsync({ type: 'blob' });
                const sanitizedPrompt = prompt.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 30) || 'animation';
                const zipFileName = `${sanitizedPrompt}.zip`;
        
                const link = document.createElement('a');
                link.href = URL.createObjectURL(content);
                link.download = zipFileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(link.href);

            } catch(err) {
                console.error("Failed to create zip file.", err);
                setError("Sorry, could not create the zip file for download.");
            }
        }
    };
    
    const isGenerationComplete = !isLoading && generatedFrames.every(f => f !== null);
    const hasGeneratedFrames = generatedFrames.some(f => f !== null);
    const totalSteps = NUM_FRAMES + 1;

    const getLoadingText = () => {
        if (!isLoading) return 'Generate Frames';
        const framesDone = Math.max(0, progress - 1);
        if (progress < 1) return 'Generating animation plan...';
        return `${loadingMessage} ${framesDone}/${NUM_FRAMES}...`;
    };

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
                        {getLoadingText()}
                    </button>
                    {(isLoading || hasGeneratedFrames) && (
                        <div className="text-center text-sm text-gray-400 mt-2">
                            Estimated Cost: <span className="font-semibold text-gray-300">${estimatedCost.toFixed(5)}</span>
                        </div>
                    )}
                    {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
                </div>
                
                {/* Output */}
                <div className="flex flex-col items-center justify-center bg-black/20 rounded-lg p-4 min-h-[300px]">
                    {hasGeneratedFrames ? (
                        <div className="w-full">
                            {isLoading && (
                                <div className="relative pt-1">
                                    <div className="overflow-hidden h-4 mb-4 text-xs flex rounded-full bg-purple-900">
                                        <div style={{ width: `${(progress / totalSteps) * 100}%` }} className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"></div>
                                    </div>
                                </div>
                            )}
                            {!isLoading && <h3 className="text-xl font-semibold mb-4 text-center">Generated Frames</h3>}
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

            {hasGeneratedFrames && (
                 <section className="w-full max-w-5xl mt-8 bg-gray-800 p-8 rounded-2xl shadow-2xl text-center">
                    <h2 className="text-2xl font-bold mb-4 text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600">
                        Animation Preview
                    </h2>
                    <div className="flex flex-col items-center justify-center">
                         <div className="flex items-center justify-center gap-3 mb-4 w-full max-w-xs">
                            <label htmlFor="fps-slider" className="text-sm text-gray-400 whitespace-nowrap">
                                FPS: <span className="font-bold text-gray-200 w-6 inline-block text-right">{fps}</span>
                            </label>
                            <input
                                id="fps-slider"
                                type="range"
                                min="1"
                                max="20"
                                value={fps}
                                onChange={(e) => setFps(Number(e.target.value))}
                                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-pink-500"
                                aria-label="Animation speed in frames per second"
                            />
                        </div>
                        <AnimationPlayer frames={generatedFrames} fps={fps} />
                    </div>
                    {isGenerationComplete && (
                         <div className="mt-6">
                            <button
                                onClick={handleDownload}
                                className="rounded-md bg-pink-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-pink-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                Download Frames (.zip)
                            </button>
                        </div>
                    )}
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