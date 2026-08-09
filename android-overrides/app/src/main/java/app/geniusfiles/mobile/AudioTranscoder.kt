package app.geniusfiles.mobile

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Traitement réel de la piste audio.
 *
 * Le son est décodé en PCM 16 bits, retravaillé (volume, vitesse) puis
 * réencodé en AAC. C'est ce qui permet à la vitesse vidéo et au volume
 * d'exister vraiment dans le fichier écrit, et non seulement dans
 * l'aperçu. Sert aussi à l'extraction de la bande son vers un fichier
 * autonome.
 *
 * Limite assumée : le changement de vitesse est un rééchantillonnage
 * linéaire, donc la hauteur du son suit la vitesse (comme une bande qu'on
 * accélère). L'interface le dit explicitement plutôt que de laisser croire
 * à une correction de hauteur qui n'existe pas.
 */
object AudioTranscoder {

    private const val TIMEOUT_US = 10_000L
    private const val BITRATE = 128_000

    /** Piste audio importée posée sur la timeline de sortie (étape 7). */
    data class Clip(
        val path: String,
        /** Position de départ sur la sortie. */
        val startUs: Long,
        /** Décalage à l'intérieur du fichier source. */
        val offsetUs: Long,
        /** Durée jouée ; 0 = jusqu'à la fin du fichier. */
        val durationUs: Long,
        val volume: Double,
    )

    /**
     * @return `false` si la source n'a aucune piste audio exploitable
     *         (aucun fichier n'est alors écrit).
     */
    fun process(
        inputPath: String,
        outputPath: String,
        segments: List<VideoTranscoder.Segment>,
        speed: Double,
        volume: Double,
        cancel: AtomicBoolean,
        /** Pistes importées mixées au son d'origine (étape 7). */
        clips: List<Clip> = emptyList(),
        /** Durée de sortie attendue, utile quand la vidéo n'a pas de son. */
        totalOutUs: Long = 0L,
        onProgress: (Double) -> Unit,
    ): Boolean {
        val extractorProbe = MediaExtractor()
        val trackIndex: Int
        val inputFormat: MediaFormat
        try {
            extractorProbe.setDataSource(inputPath)
            var found = -1
            for (i in 0 until extractorProbe.trackCount) {
                val mime = extractorProbe.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: continue
                if (mime.startsWith("audio/")) { found = i; break }
            }
            // Sans son d'origine, une piste importée reste exportable : on
            // fabrique alors une base silencieuse de la bonne durée.
            if (found < 0 && clips.isEmpty()) return false
            trackIndex = found
            inputFormat = if (found >= 0) extractorProbe.getTrackFormat(found)
            else MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_RAW, 44_100, 2)
        } finally {
            try { extractorProbe.release() } catch (_: Throwable) {}
        }

        val silentBase = trackIndex < 0
        val mime = inputFormat.getString(MediaFormat.KEY_MIME) ?: return false
        val sampleRate = inputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        val channels = inputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT).coerceIn(1, 2)

        val encFormat = MediaFormat.createAudioFormat(
            MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, channels
        ).apply {
            setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            setInteger(MediaFormat.KEY_BIT_RATE, BITRATE)
            setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 64 * 1024)
        }
        val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
        encoder.configure(encFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        encoder.start()

        val muxer = MediaMuxer(outputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        var muxerStarted = false
        var muxTrack = -1
        val encInfo = MediaCodec.BufferInfo()

        // Rééchantillonnage : position fractionnaire dans le flux d'entrée,
        // conservée d'un bloc à l'autre pour ne créer ni clic ni dérive.
        var phase = 0.0
        var carry = ShortArray(channels)
        var hasCarry = false
        var framesWritten = 0L
        val pending = ArrayList<Short>(8192)
        val mix = AudioMix(clips, sampleRate, channels)

        fun drainEncoder(endOfStream: Boolean) {
            while (true) {
                val index = encoder.dequeueOutputBuffer(encInfo, if (endOfStream) TIMEOUT_US else 0)
                if (index == MediaCodec.INFO_TRY_AGAIN_LATER) {
                    if (!endOfStream) return
                    continue
                }
                if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    if (!muxerStarted) {
                        muxTrack = muxer.addTrack(encoder.outputFormat)
                        muxer.start()
                        muxerStarted = true
                    }
                    continue
                }
                if (index < 0) return
                val buf = encoder.getOutputBuffer(index)!!
                if (encInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) encInfo.size = 0
                if (encInfo.size > 0 && muxerStarted) {
                    buf.position(encInfo.offset)
                    buf.limit(encInfo.offset + encInfo.size)
                    muxer.writeSampleData(muxTrack, buf, encInfo)
                }
                val eos = encInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                encoder.releaseOutputBuffer(index, false)
                if (eos) return
            }
        }

        /** Pousse les échantillons prêts vers l'encodeur, par blocs entiers. */
        fun feedEncoder(flush: Boolean) {
            while (pending.size >= channels) {
                val index = encoder.dequeueInputBuffer(TIMEOUT_US)
                if (index < 0) {
                    drainEncoder(false)
                    if (!flush) return
                    continue
                }
                val buf = encoder.getInputBuffer(index)!!
                buf.clear()
                val capacityFrames = (buf.capacity() / 2 / channels).coerceAtLeast(1)
                val frames = minOf(capacityFrames, pending.size / channels)
                val shorts = buf.order(ByteOrder.nativeOrder()).asShortBuffer()
                for (i in 0 until frames * channels) {
                    var v = pending[i].toInt()
                    if (!mix.isEmpty) v += mix.sample(framesWritten + i / channels, i % channels)
                    shorts.put(v.coerceIn(-32768, 32767).toShort())
                }
                repeat(frames * channels) { pending.removeAt(0) }
                val ptsUs = framesWritten * 1_000_000L / sampleRate
                encoder.queueInputBuffer(index, 0, frames * channels * 2, ptsUs, 0)
                framesWritten += frames
                drainEncoder(false)
            }
        }

        try {
            val totalUs = segments.sumOf { (it.endUs - it.startUs).coerceAtLeast(0) }.coerceAtLeast(1)
            var doneUs = 0L

            for (seg in if (silentBase) emptyList() else segments) {
                if (cancel.get()) throw VideoTranscoder.CancelledException()
                val extractor = MediaExtractor()
                var decoder: MediaCodec? = null
                try {
                    extractor.setDataSource(inputPath)
                    extractor.selectTrack(trackIndex)
                    extractor.seekTo(seg.startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
                    val dec = MediaCodec.createDecoderByType(mime)
                    dec.configure(inputFormat, null, null, 0)
                    dec.start()
                    decoder = dec

                    val info = MediaCodec.BufferInfo()
                    var inputDone = false
                    var decodeDone = false
                    val span = (seg.endUs - seg.startUs).coerceAtLeast(1)

                    while (!decodeDone) {
                        if (cancel.get()) throw VideoTranscoder.CancelledException()
                        if (!inputDone) {
                            val index = dec.dequeueInputBuffer(TIMEOUT_US)
                            if (index >= 0) {
                                val buf = dec.getInputBuffer(index)!!
                                val size = extractor.readSampleData(buf, 0)
                                val time = extractor.sampleTime
                                if (size < 0 || time > seg.endUs) {
                                    dec.queueInputBuffer(
                                        index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM
                                    )
                                    inputDone = true
                                } else {
                                    dec.queueInputBuffer(index, 0, size, time, extractor.sampleFlags)
                                    extractor.advance()
                                }
                            }
                        }

                        val index = dec.dequeueOutputBuffer(info, TIMEOUT_US)
                        if (index >= 0) {
                            val pts = info.presentationTimeUs
                            val keep = info.size > 0 && pts >= seg.startUs && pts <= seg.endUs
                            if (keep) {
                                val out = dec.getOutputBuffer(index)!!
                                out.position(info.offset)
                                out.limit(info.offset + info.size)
                                val chunk = out.order(ByteOrder.nativeOrder()).asShortBuffer()
                                val frames = chunk.remaining() / channels
                                val src = ShortArray(chunk.remaining())
                                chunk.get(src)

                                // Volume puis vitesse : on écrit exactement ce
                                // que l'utilisateur entend dans l'aperçu.
                                if (volume != 1.0) {
                                    for (i in src.indices) {
                                        val v = (src[i] * volume).toInt().coerceIn(-32768, 32767)
                                        src[i] = v.toShort()
                                    }
                                }

                                if (speed == 1.0) {
                                    for (s in src) pending.add(s)
                                } else {
                                    var p = phase
                                    while (p < frames) {
                                        val i0 = kotlin.math.floor(p).toInt()
                                        val frac = (p - i0).toFloat()
                                        for (c in 0 until channels) {
                                            val a = if (i0 < 0) {
                                                if (hasCarry) carry[c].toFloat() else src[c].toFloat()
                                            } else src[i0 * channels + c].toFloat()
                                            val nextIndex = i0 + 1
                                            val b = if (nextIndex < frames)
                                                src[nextIndex * channels + c].toFloat() else a
                                            val v = (a + (b - a) * frac).toInt().coerceIn(-32768, 32767)
                                            pending.add(v.toShort())
                                        }
                                        p += speed
                                    }
                                    phase = p - frames
                                    if (frames > 0) {
                                        for (c in 0 until channels) {
                                            carry[c] = src[(frames - 1) * channels + c]
                                        }
                                        hasCarry = true
                                    }
                                }
                                feedEncoder(false)
                                onProgress(
                                    ((doneUs + (pts - seg.startUs)).toDouble() / totalUs)
                                        .coerceIn(0.0, 0.99)
                                )
                            }
                            dec.releaseOutputBuffer(index, false)
                            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                                decodeDone = true
                            }
                        }
                        if (span == 0L) decodeDone = true
                    }
                } finally {
                    try { decoder?.stop() } catch (_: Throwable) {}
                    try { decoder?.release() } catch (_: Throwable) {}
                    try { extractor.release() } catch (_: Throwable) {}
                }
                doneUs += (seg.endUs - seg.startUs).coerceAtLeast(0)
            }

            if (silentBase) {
                // Base muette : seule la ou les pistes importées s'entendent.
                val span = maxOf(
                    totalOutUs * sampleRate / 1_000_000L,
                    mix.lastFrame,
                ).coerceAtLeast(1L)
                var produced = 0L
                while (produced < span) {
                    if (cancel.get()) throw VideoTranscoder.CancelledException()
                    val block = minOf(4096L, span - produced).toInt()
                    repeat(block * channels) { pending.add(0) }
                    feedEncoder(false)
                    produced += block
                    onProgress((produced.toDouble() / span).coerceIn(0.0, 0.99))
                }
            }

            feedEncoder(true)
            val index = encoder.dequeueInputBuffer(TIMEOUT_US * 5)
            if (index >= 0) {
                encoder.queueInputBuffer(
                    index, 0, 0, framesWritten * 1_000_000L / sampleRate,
                    MediaCodec.BUFFER_FLAG_END_OF_STREAM
                )
            }
            drainEncoder(true)
            return muxerStarted && framesWritten > 0
        } finally {
            try { encoder.stop() } catch (_: Throwable) {}
            try { encoder.release() } catch (_: Throwable) {}
            if (muxerStarted) { try { muxer.stop() } catch (_: Throwable) {} }
            try { muxer.release() } catch (_: Throwable) {}
        }
    }

    /** Recopie les pistes de deux fichiers dans un seul MP4 final. */
    fun combine(videoOnly: File, audioOnly: File?, outputPath: String) {
        val muxer = MediaMuxer(outputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        val sources = ArrayList<Pair<MediaExtractor, Int>>()
        try {
            var maxBuffer = 256 * 1024
            for (file in listOfNotNull(videoOnly, audioOnly)) {
                val ex = MediaExtractor()
                ex.setDataSource(file.absolutePath)
                for (i in 0 until ex.trackCount) {
                    val format = ex.getTrackFormat(i)
                    val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
                    if (!mime.startsWith("video/") && !mime.startsWith("audio/")) continue
                    if (format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
                        maxBuffer = maxOf(maxBuffer, format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE))
                    }
                    ex.selectTrack(i)
                    sources.add(ex to muxer.addTrack(format))
                    break
                }
            }
            check(sources.isNotEmpty()) { "UNSUPPORTED" }
            muxer.start()
            val buffer = ByteBuffer.allocate(maxBuffer)
            val info = MediaCodec.BufferInfo()
            for ((ex, track) in sources) {
                while (true) {
                    val size = ex.readSampleData(buffer, 0)
                    if (size < 0) break
                    info.offset = 0
                    info.size = size
                    info.presentationTimeUs = ex.sampleTime.coerceAtLeast(0)
                    info.flags = ex.sampleFlags
                    muxer.writeSampleData(track, buffer, info)
                    ex.advance()
                }
            }
        } finally {
            try { muxer.stop() } catch (_: Throwable) {}
            try { muxer.release() } catch (_: Throwable) {}
            for ((ex, _) in sources) { try { ex.release() } catch (_: Throwable) {} }
        }
    }
}
