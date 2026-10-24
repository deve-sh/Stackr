"""Optional end-to-end 60 fps check. Requires FFmpeg/ffprobe, only for development.

Generate three clips, load them top-to-bottom into the three-row layout without
zoom/repositioning, export, then verify. Each source frame carries an 8-bit ID;
this catches repeated/skipped source frames even in an MP4 labelled '60 fps'.
"""
import argparse
import json
import subprocess
from fractions import Fraction
from pathlib import Path

OFFSETS = [0, 17, 79]
FRAME_COUNT = 240  # Four seconds, the shortest input, at 60 fps.


def generate(folder):
    folder.mkdir(parents=True, exist_ok=True)
    for offset, seconds in zip(OFFSETS, [4, 5, 6]):
        pattern = f"geq=lum='16+219*mod(floor((N+{offset})/pow(2,floor(X/80))),2)':cb=128:cr=128"
        path = folder / f"cadence-{offset}-60.mp4"
        subprocess.run([
            'ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
            f'nullsrc=size=640x360:rate=60:duration={seconds}', '-vf', pattern,
            '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-g', '60',
            '-pix_fmt', 'yuv420p', '-an', '-y', str(path),
        ], check=True)
        print(path)


def verify(path):
    info = json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', str(path),
    ]))
    videos = [stream for stream in info['streams'] if stream['codec_type'] == 'video']
    if len(videos) != 1 or any(stream['codec_type'] == 'audio' for stream in info['streams']):
        raise ValueError('Expected one video track and no audio.')
    video = videos[0]
    if (video['codec_name'], video['width'], video['height']) != ('h264', 1080, 1920):
        raise ValueError('Expected a 1080 x 1920 H.264 export.')
    if Fraction(video['avg_frame_rate']) != 60 or int(video['nb_read_frames']) != FRAME_COUNT:
        raise ValueError('The export does not contain exactly 240 frames at 60 fps.')
    for row, offset in enumerate(OFFSETS):
        data = subprocess.check_output([
            'ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(path), '-vf',
            f'crop=1080:640:0:{row * 640},scale=8:1:flags=neighbor,format=gray',
            '-fps_mode', 'passthrough', '-f', 'rawvideo', '-',
        ])
        ids = [sum(1 << bit for bit, value in enumerate(data[i:i + 8]) if value > 128)
               for i in range(0, len(data), 8)]
        if len(ids) != FRAME_COUNT:
            raise ValueError(f'Row {row + 1}: decoded {len(ids)} frames instead of {FRAME_COUNT}.')
        for index, frame_id in enumerate(ids):
            expected = (index + offset) % 256
            if frame_id != expected:
                raise ValueError(f'Row {row + 1}, frame {index}: source ID {frame_id}, expected {expected}.')
        print(f'Row {row + 1}: all {FRAME_COUNT} source frames preserved in sequence.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('generate').add_argument('folder', type=Path)
    commands.add_parser('verify').add_argument('export', type=Path)
    args = parser.parse_args()
    if args.command == 'generate':
        generate(args.folder)
    else:
        verify(getattr(args, 'export'))
