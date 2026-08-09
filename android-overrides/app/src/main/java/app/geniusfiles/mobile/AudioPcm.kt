package app.geniusfiles.mobile

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.nio.ByteOrder

/**
 * Décodage PCM d'un fichier audio importé (étape 7).
 *
 * Le fichier est décodé en entier (dans la limite demandée), converti au
 * taux d'échantillonnage et au nombre de canaux de la piste de sortie, puis
 * gardé en mémoire : c'est ce qui permet de le mixer image par image avec
 * le son d'origine sans relire le fichier à chaque bloc.
 */
object AudioPcm {

    private const val TIMEOUT_US = 10_000L
    /** Garde-fou mémoire : 10 min en 48 kHz stéréo ≈ 115 Mo de PCM. */
    private const val MAX_FRAMES = 48_000L * 60 * 10

    /**
     * @param offsetUs début de lecture à l'intérieur du fichier.
     * @param durationUs durée à extraire ; 0 = jusqu'à la fin.
     * @return PCM 16 bits entrelacé au format cible, vide si illisible.
     */
    fun decode(
        path: String,
        targetRate: Int,
        targetChannels: Int,
        offsetUs: Long,
        durationUs: Long,
    ): ShortArray {
        val extractor = MediaExtractor()
        var decoder: MediaCodec? = null
        try {
            extractor.setDataSource(path)
            var track = -1
            for (i in 0 until extractor.trackCount) {
                val m = extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: continue
                if (m.startsWith("audio/")) { track = i; break }
            }
            if (track < 0) return ShortArray(0)
            val format = extractor.getTrackFormat(track)
            val mime = format.getString(MediaFormat.KEY_MIME) ?: return ShortArray(0)
            val srcRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            val srcChannels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT).coerceAtLeast(1)
            extractor.selectTrack(track)
            if (offsetUs > 0) extractor.seekTo(offsetUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC)

            val dec = MediaCodec.createDecoderByType(mime)
            dec.configure(format, null, null, 0)
            dec.start()
            decoder = dec

            val endUs = if (durationUs > 0) offsetUs + durationUs else Long.MAX_VALUE
            val raw = ArrayList<Short>(1 shl 16)
            val info = MediaCodec.BufferInfo()
            var inputDone = false
            var done = false

            while (!done) {
                if (!inputDone) {
                    val index = dec.dequeueInputBuffer(TIMEOUT_US)
                    if (index >= 0) {
                        val buf = dec.getInputBuffer(index)!!
                        val size = extractor.readSampleData(buf, 0)
                        val time = extractor.sampleTime
                        if (size < 0 || time > endUs) {
                            dec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            dec.queueInputBuffer(index, 0, size, time, extractor.sampleFlags)
                            extractor.advance()
                        }
                    }
                }
                val index = dec.dequeueOutputBuffer(info, TIMEOUT_US)
                if (index >= 0) {
                    if (info.size > 0 && info.presentationTimeUs >= offsetUs) {
                        val out = dec.getOutputBuffer(index)!!
                        out.position(info.offset)
                        out.limit(info.offset + info.size)
                        val chunk = out.order(ByteOrder.nativeOrder()).asShortBuffer()
                        while (chunk.hasRemaining() && raw.size < MAX_FRAMES * srcChannels) {
                            raw.add(chunk.get())
                        }
                    }
                    dec.releaseOutputBuffer(index, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) done = true
                }
                if (raw.size >= MAX_FRAMES * srcChannels) done = true
            }

            if (raw.isEmpty()) return ShortArray(0)
            return convert(raw, srcRate, srcChannels, targetRate, targetChannels)
        } catch (_: Throwable) {
            return ShortArray(0)
        } finally {
            try { decoder?.stop() } catch (_: Throwable) {}
            try { decoder?.release() } catch (_: Throwable) {}
            try { extractor.release() } catch (_: Throwable) {}
        }
    }

    /** Rééchantillonnage linéaire et adaptation du nombre de canaux. */
    private fun convert(
        raw: List<Short>,
        srcRate: Int,
        srcChannels: Int,
        dstRate: Int,
        dstChannels: Int,
    ): ShortArray {
        val srcFrames = raw.size / srcChannels
        if (srcFrames == 0) return ShortArray(0)
        val ratio = srcRate.toDouble() / dstRate.toDouble()
        val dstFrames = (srcFrames / ratio).toInt().coerceAtLeast(1)
        val out = ShortArray(dstFrames * dstChannels)
        for (f in 0 until dstFrames) {
            val pos = f * ratio
            val i0 = pos.toInt().coerceIn(0, srcFrames - 1)
            val i1 = (i0 + 1).coerceAtMost(srcFrames - 1)
            val frac = (pos - i0).toFloat()
            for (c in 0 until dstChannels) {
                val sc = if (c < srcChannels) c else srcChannels - 1
                val a = raw[i0 * srcChannels + sc].toFloat()
                val b = raw[i1 * srcChannels + sc].toFloat()
                out[f * dstChannels + c] = (a + (b - a) * frac).toInt()
                    .coerceIn(-32768, 32767).toShort()
            }
        }
        return out
    }
}

/**
 * Bancs de pistes importées, interrogeables par numéro d'échantillon de
 * sortie : le mixage est exact, sans dérive, quelle que soit la taille des
 * blocs envoyés à l'encodeur.
 */
class AudioMix(
    clips: List<AudioTranscoder.Clip>,
    private val sampleRate: Int,
    private val channels: Int,
) {
    private class Entry(
        val data: ShortArray,
        val startFrame: Long,
        val frames: Long,
        val volume: Float,
    )

    private val entries: List<Entry> = clips.mapNotNull { c ->
        val pcm = AudioPcm.decode(c.path, sampleRate, channels, c.offsetUs, c.durationUs)
        if (pcm.isEmpty()) null
        else Entry(
            data = pcm,
            startFrame = c.startUs * sampleRate / 1_000_000L,
            frames = (pcm.size / channels).toLong(),
            volume = c.volume.toFloat().coerceIn(0f, 4f),
        )
    }

    val isEmpty: Boolean get() = entries.isEmpty()

    /** Contribution des pistes importées à cet échantillon de sortie. */
    fun sample(frame: Long, channel: Int): Int {
        if (entries.isEmpty()) return 0
        var sum = 0
        for (e in entries) {
            val rel = frame - e.startFrame
            if (rel < 0 || rel >= e.frames) continue
            sum += (e.data[(rel * channels + channel).toInt()] * e.volume).toInt()
        }
        return sum
    }

    /** Dernier échantillon couvert par une piste importée. */
    val lastFrame: Long get() = entries.maxOfOrNull { it.startFrame + it.frames } ?: 0L
}
