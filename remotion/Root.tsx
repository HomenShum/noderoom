import React from "react";
import { Composition } from "remotion";
import { Walkthrough, calcDurationInFrames, FPS, CHROME_H, type Feature } from "./Walkthrough";
import data from "./walkthrough.data.js";
import { Episode, EP_FPS, EP_SIZE, type EpisodeData } from "./Episode";
import episodeData from "./episode.data.js";

/** One composition per captured feature — duration derives from the LIVE captured segment data. */
export const Root: React.FC = () => (
  <>
    {(data.features as Feature[]).filter((f) => !f.skipped && f.segments.length > 0).map((f) => (
      <Composition
        key={f.id}
        id={f.id}
        component={Walkthrough}
        durationInFrames={calcDurationInFrames(f)}
        fps={FPS}
        width={data.viewport.width}
        height={data.viewport.height + CHROME_H}
        defaultProps={{ feature: f }}
      />
    ))}
    {(episodeData as EpisodeData).scenes?.length > 0 && (
      <Composition
        id="episode-short"
        component={Episode}
        durationInFrames={(episodeData as EpisodeData).totalFrames}
        fps={EP_FPS}
        width={EP_SIZE.width}
        height={EP_SIZE.height}
        defaultProps={{ data: episodeData as EpisodeData }}
      />
    )}
  </>
);
