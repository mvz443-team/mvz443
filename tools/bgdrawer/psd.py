import struct
from pathlib import Path


def pack_pascal_string(value):
    encoded = value.encode("ascii", "replace")[:63]
    data = bytes([len(encoded)]) + encoded
    padding = (4 - len(data) % 4) % 4
    return data + (b"\0" * padding)


def layer_channels(layer):
    red, green, blue, alpha = layer.split()
    return [
        (0, red.tobytes()),
        (1, green.tobytes()),
        (2, blue.tobytes()),
        (-1, alpha.tobytes()),
    ]


def write_layered_psd(path, canvas_size, layers, composite):
    width, height = canvas_size
    ordered_layers = list(layers)
    layer_records = bytearray()
    layer_image_data = bytearray()

    for name, layer in ordered_layers:
        channels = layer_channels(layer)
        layer_records.extend(struct.pack(">iiiiH", 0, 0, height, width, len(channels)))

        for channel_id, channel_data in channels:
            layer_records.extend(struct.pack(">hI", channel_id, len(channel_data) + 2))

        extra_data = bytearray()
        extra_data.extend(struct.pack(">I", 0))  # layer mask data
        extra_data.extend(struct.pack(">I", 0))  # layer blending ranges
        extra_data.extend(pack_pascal_string(name))

        layer_records.extend(b"8BIM")
        layer_records.extend(b"norm")
        layer_records.extend(bytes([255, 0, 8, 0]))
        layer_records.extend(struct.pack(">I", len(extra_data)))
        layer_records.extend(extra_data)

        for _, channel_data in channels:
            layer_image_data.extend(struct.pack(">H", 0))
            layer_image_data.extend(channel_data)

    layer_info = bytearray()
    layer_info.extend(struct.pack(">h", len(ordered_layers)))
    layer_info.extend(layer_records)
    layer_info.extend(layer_image_data)
    if len(layer_info) % 2:
        layer_info.extend(b"\0")

    layer_and_mask_info = bytearray()
    layer_and_mask_info.extend(struct.pack(">I", len(layer_info)))
    layer_and_mask_info.extend(layer_info)
    layer_and_mask_info.extend(struct.pack(">I", 0))  # global layer mask info

    composite_channels = layer_channels(composite)
    merged_image_data = bytearray(struct.pack(">H", 0))
    for _, channel_data in composite_channels:
        merged_image_data.extend(channel_data)

    psd = bytearray()
    psd.extend(b"8BPS")
    psd.extend(struct.pack(">H", 1))
    psd.extend(b"\0" * 6)
    psd.extend(struct.pack(">HIIHH", 4, height, width, 8, 3))
    psd.extend(struct.pack(">I", 0))  # color mode data
    psd.extend(struct.pack(">I", 0))  # image resources
    psd.extend(struct.pack(">I", len(layer_and_mask_info)))
    psd.extend(layer_and_mask_info)
    psd.extend(merged_image_data)

    Path(path).write_bytes(psd)
