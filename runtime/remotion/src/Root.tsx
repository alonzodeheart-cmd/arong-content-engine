import React from 'react';
import {Composition} from 'remotion';
import {ContentVideo, type VideoProps} from './ContentVideo';

const defaultProps: VideoProps = {
  title: '内容视频',
  creatorName: '创作者',
  lane: 'thought',
  duration: 10,
  audio: 'runtime/narration.wav',
  scenes: [
    {start: 0, end: 10, type: 'diagram', text: '等待载入正式分镜', asset: null, source: null},
  ],
  captions: [],
};

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="ContentVideo9x16"
        component={ContentVideo}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={300}
        defaultProps={defaultProps}
        calculateMetadata={({props}) => ({
          durationInFrames: Math.max(1, Math.ceil(props.duration * 30)),
        })}
      />
    </>
  );
};
