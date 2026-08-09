package app.geniusfiles.mobile

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Moteur d'export vidéo natif de GeniusFiles.
 *
 * Deux chemins, choisis selon ce que l'utilisateur a réellement demandé :
 *
 *  - **Remux (sans perte)** : un seul segment, aucune transformation d'image.
 *    Les paquets encodés d'origine sont recopiés tels quels
 *    (`MediaExtractor` → `MediaMuxer`). Rapide, aucune dégradation, mais la
 *    coupe démarre sur l'image-clé précédente.
 *  - **Réencodage exact** : décodage matériel → surface OpenGL → encodage
 *    H.264 → muxing. La coupe tombe exactement sur l'instant demandé, et
 *    **plusieurs segments sont réellement concaténés** dans un flux continu
 *    (étape 4 : division, suppression d'une portion au milieu). C'est ce même
 *    chemin qui portera les transformations des étapes suivantes.
 *
 * Le fichier source n'est jamais modifié : la sortie est écrite ailleurs, et
 * un échec ou une annulation supprime le fichier partiel.
 */
object VideoTranscoder {

    private const val TIMEOUT_US = 10_000L
    private const val DEFAULT_BITRATE_FACTOR = 0.9

    class CancelledException : Exception("Export annulé")

    /** Portion conservée de la source, en microsecondes. */
    data class Segment(val startUs: Long, val endUs: Long)

    /**
     * Transformations demandées. Toutes les valeurs par défaut sont neutres :
     * un export sans réglage produit exactement l'image d'origine.
     */
    data class Edit(
        /** Rotation en degrés appliquée aux pixels : 0, 90, 180 ou 270. */
        val rotation: Int = 0,
        val cropX: Float = 0f,
        val cropY: Float = 0f,
        val cropW: Float = 1f,
        val cropH: Float = 1f,
        /** Petit côté visé pour la sortie ; 0 = résolution d'origine. */
        val targetShortSide: Int = 0,
        val speed: Double = 1.0,
        val volume: Double = 1.0,
        val muted: Boolean = false,
        val brightness: Float = 0f,
        val contrast: Float = 0f,
        val exposure: Float = 0f,
        val saturation: Float = 0f,
        val temperature: Float = 0f,
        val tint: Float = 0f,
        val sharpness: Float = 0f,
        /** Calques composés à l'export (étape 7). */
        val layers: List<OverlayLayer> = emptyList(),
        /** Pistes audio importées, mixées à l'export (étape 7). */
        val audioClips: List<AudioTranscoder.Clip> = emptyList(),
    ) {
        /** Aucune transformation d'image ni de son : la copie suffit. */
        val isIdentity: Boolean
            get() = rotation == 0 && cropX == 0f && cropY == 0f && cropW == 1f && cropH == 1f &&
                targetShortSide == 0 && speed == 1.0 && volume == 1.0 && !muted &&
                brightness == 0f && contrast == 0f && exposure == 0f && saturation == 0f &&
                temperature == 0f && tint == 0f && sharpness == 0f &&
                layers.isEmpty() && audioClips.isEmpty()

        fun toRenderParams(extraRotation: Int) = GlRenderParams(
            cropX = cropX, cropY = cropY, cropW = cropW, cropH = cropH,
            rotation = ((rotation + extraRotation) % 360 + 360) % 360,
            brightness = brightness, contrast = contrast, exposure = exposure,
            saturation = saturation, temperature = temperature, tint = tint,
            sharpness = sharpness,
        )
    }

    data class Request(
        val inputPath: String,
        val outputPath: String,
        /** Segments conservés, dans l'ordre du montage. Jamais vide. */
        val segments: List<Segment>,
        /** Coupe à l'image près : impose le réencodage. */
        val exact: Boolean,
        val edit: Edit = Edit(),
    )

    /**
     * @param onProgress progression 0..1, appelée depuis le thread d'export.
     * @return la durée réelle écrite, en microsecondes.
     */
    fun export(req: Request, cancel: AtomicBoolean, onProgress: (Double) -> Unit): Long {
        val input = File(req.inputPath)
        if (!input.exists() || input.isDirectory) throw IllegalArgumentException("NOT_FOUND")
        if (req.segments.isEmpty()) throw IllegalArgumentException("EMPTY_SELECTION")
        val out = File(req.outputPath)
        out.parentFile?.mkdirs()
        try {
            // La copie sans perte ne sait ni raccorder deux morceaux ni
            // transformer l'image : dès qu'on le demande, réencodage réel.
            val needsEncode = req.exact || req.segments.size > 1 || !req.edit.isIdentity
            val written = if (needsEncode) transcode(req, cancel, onProgress)
            else remux(req, cancel, onProgress)
            onProgress(1.0)
            return written
        } catch (t: Throwable) {
            try { out.delete() } catch (_: Throwable) {}
            throw t
        }
    }

    /**
     * Extraction de la bande son vers un fichier autonome (M4A/AAC),
     * montage et réglages compris. `false` si la vidéo n'a pas de son.
     */
    fun extractAudio(
        inputPath: String,
        outputPath: String,
        segments: List<Segment>,
        speed: Double,
        volume: Double,
        cancel: AtomicBoolean,
        onProgress: (Double) -> Unit,
    ): Boolean {
        val out = File(outputPath)
        out.parentFile?.mkdirs()
        return try {
            AudioTranscoder.process(
                inputPath, outputPath, segments, speed, volume, cancel,
                onProgress = onProgress,
            )
        } catch (t: Throwable) {
            try { out.delete() } catch (_: Throwable) {}
            throw t
        }
    }


    // ---------------------------------------------------------------- remux

    private fun remux(req: Request, cancel: AtomicBoolean, onProgress: (Double) -> Unit): Long {
        val seg = req.segments.first()
        val extractor = MediaExtractor()
        var muxer: MediaMuxer? = null
        try {
            extractor.setDataSource(req.inputPath)
            val indexMap = HashMap<Int, Int>()
            muxer = MediaMuxer(req.outputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)

            var maxBuffer = 256 * 1024
            for (i in 0 until extractor.trackCount) {
                val format = extractor.getTrackFormat(i)
                val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
                if (!mime.startsWith("video/") && !mime.startsWith("audio/")) continue
                if (format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
                    maxBuffer = maxOf(maxBuffer, format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE))
                }
                extractor.selectTrack(i)
                indexMap[i] = muxer.addTrack(format)
            }
            if (indexMap.isEmpty()) throw IllegalStateException("UNSUPPORTED")

            rotationOf(req.inputPath)?.let { muxer.setOrientationHint(it) }
            muxer.start()

            val buffer = ByteBuffer.allocate(maxBuffer)
            val info = MediaCodec.BufferInfo()
            extractor.seekTo(seg.startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
            val span = (seg.endUs - seg.startUs).coerceAtLeast(1)
            var base = -1L
            var last = 0L

            while (true) {
                if (cancel.get()) throw CancelledException()
                val size = extractor.readSampleData(buffer, 0)
                if (size < 0) break
                val time = extractor.sampleTime
                if (time > seg.endUs) break
                val track = indexMap[extractor.sampleTrackIndex]
                if (track != null && time >= 0) {
                    if (base < 0) base = time
                    info.offset = 0
                    info.size = size
                    info.presentationTimeUs = (time - base).coerceAtLeast(0)
                    info.flags = extractor.sampleFlags
                    muxer.writeSampleData(track, buffer, info)
                    last = info.presentationTimeUs
                    onProgress(((time - seg.startUs).toDouble() / span).coerceIn(0.0, 0.99))
                }
                extractor.advance()
            }
            return last
        } finally {
            try { muxer?.stop() } catch (_: Throwable) {}
            try { muxer?.release() } catch (_: Throwable) {}
            try { extractor.release() } catch (_: Throwable) {}
        }
    }

    // ------------------------------------------------------------ transcode

    /**
     * Réencodage complet : image (montage + transformations) puis son
     * (montage + vitesse + volume), les deux étant ensuite réunis dans le
     * MP4 final. Séparer les deux passes est la seule façon fiable de
     * connaître les formats des deux pistes avant de démarrer le muxer.
     */
    private fun transcode(req: Request, cancel: AtomicBoolean, onProgress: (Double) -> Unit): Long {
        val videoTmp = File("${req.outputPath}.video.tmp")
        val audioTmp = File("${req.outputPath}.audio.tmp")
        try {
            val written = transcodeVideo(req, videoTmp.absolutePath, cancel) {
                onProgress((it * 0.82).coerceIn(0.0, 0.82))
            }
            var hasAudio = false
            val audible = !req.edit.muted && req.edit.volume > 0.0
            if (audible || req.edit.audioClips.isNotEmpty()) {
                hasAudio = try {
                    AudioTranscoder.process(
                        req.inputPath, audioTmp.absolutePath, req.segments,
                        req.edit.speed, if (audible) req.edit.volume else 0.0, cancel,
                        req.edit.audioClips,
                        // Durée de sortie, indispensable si la vidéo n'a pas
                        // de son : la base silencieuse doit être aussi longue.
                        (written.coerceAtLeast(0L)),
                    ) { onProgress((0.82 + it * 0.13).coerceIn(0.0, 0.95)) }
                } catch (c: CancelledException) {
                    throw c
                } catch (_: Throwable) {
                    // Une piste audio illisible ne doit pas faire perdre le
                    // montage vidéo : on l'annonce en écrivant la vidéo seule.
                    false
                }
            }
            if (hasAudio && audioTmp.exists() && audioTmp.length() > 0) {
                AudioTranscoder.combine(videoTmp, audioTmp, req.outputPath)
            } else {
                if (!videoTmp.renameTo(File(req.outputPath))) {
                    videoTmp.copyTo(File(req.outputPath), overwrite = true)
                }
            }
            return written
        } finally {
            try { videoTmp.delete() } catch (_: Throwable) {}
            try { audioTmp.delete() } catch (_: Throwable) {}
        }
    }

    private fun transcodeVideo(
        req: Request,
        outputPath: String,
        cancel: AtomicBoolean,
        onProgress: (Double) -> Unit,
    ): Long {
        val probe = MediaExtractor()
        val inputFormat: MediaFormat
        val videoTrack: Int
        try {
            probe.setDataSource(req.inputPath)
            videoTrack = firstTrack(probe, "video/")
            if (videoTrack < 0) throw IllegalStateException("UNSUPPORTED")
            inputFormat = probe.getTrackFormat(videoTrack)
        } finally {
            try { probe.release() } catch (_: Throwable) {}
        }

        val mime = inputFormat.getString(MediaFormat.KEY_MIME)
            ?: throw IllegalStateException("UNSUPPORTED")
        val width = even(inputFormat.getInteger(MediaFormat.KEY_WIDTH))
        val height = even(inputFormat.getInteger(MediaFormat.KEY_HEIGHT))
        val frameRate = if (inputFormat.containsKey(MediaFormat.KEY_FRAME_RATE))
            inputFormat.getInteger(MediaFormat.KEY_FRAME_RATE) else 30
        val frameDurUs = (1_000_000L / frameRate.coerceAtLeast(1))

        // La rotation d'origine du fichier n'est pas appliquée par le
        // décodeur : on la cuit dans les pixels avec celle demandée, et la
        // sortie n'a donc plus besoin d'indication d'orientation.
        val sourceRotation = rotationOf(req.inputPath) ?: 0
        val params = req.edit.toRenderParams(sourceRotation)
        val croppedW = (width * req.edit.cropW).toInt().coerceAtLeast(2)
        val croppedH = (height * req.edit.cropH).toInt().coerceAtLeast(2)
        val swap = params.rotation == 90 || params.rotation == 270
        var outW = if (swap) croppedH else croppedW
        var outH = if (swap) croppedW else croppedH
        val target = req.edit.targetShortSide
        if (target > 0) {
            val shortSide = minOf(outW, outH)
            // Jamais d'agrandissement : on ne fabrique pas de détail absent.
            if (shortSide > target) {
                val scale = target.toDouble() / shortSide
                outW = (outW * scale).toInt()
                outH = (outH * scale).toInt()
            }
        }
        outW = even(outW).coerceAtLeast(2)
        outH = even(outH).coerceAtLeast(2)
        val bitrate = estimateBitrate(req.inputPath, outW, outH)

        val outFormat = MediaFormat.createVideoFormat("video/avc", outW, outH).apply {
            setInteger(
                MediaFormat.KEY_COLOR_FORMAT,
                MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface
            )
            setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
            setInteger(MediaFormat.KEY_FRAME_RATE, frameRate)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
        }

        val encoder = MediaCodec.createEncoderByType("video/avc")
        encoder.configure(outFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        val glSurface = GlEncoderSurface(encoder.createInputSurface())
        glSurface.makeCurrent()
        val renderer = GlFrameRenderer()
        renderer.setup()
        renderer.configure(params, width, height)
        val overlay = OverlayCompositor(req.edit.layers, outW, outH)
        val overlayGl = if (overlay.isEmpty) null else GlOverlayRenderer().also { it.setup() }
        encoder.start()

        val speed = req.edit.speed.coerceIn(0.25, 4.0)
        val muxer = MediaMuxer(outputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)

        var muxerStarted = false
        var muxVideoTrack = -1
        var lastPtsUs = 0L
        val encInfo = MediaCodec.BufferInfo()

        /** Vide l'encodeur vers le muxer ; rend `true` sur fin de flux. */
        fun drainEncoder(): Boolean {
            while (true) {
                val index = encoder.dequeueOutputBuffer(encInfo, 0)
                if (index == MediaCodec.INFO_TRY_AGAIN_LATER) return false
                if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    if (!muxerStarted) {
                        muxVideoTrack = muxer.addTrack(encoder.outputFormat)
                        muxer.start()
                        muxerStarted = true
                    }
                    continue
                }
                if (index < 0) return false
                val encoded = encoder.getOutputBuffer(index)!!
                if (encInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) encInfo.size = 0
                if (encInfo.size > 0 && muxerStarted) {
                    encoded.position(encInfo.offset)
                    encoded.limit(encInfo.offset + encInfo.size)
                    muxer.writeSampleData(muxVideoTrack, encoded, encInfo)
                    lastPtsUs = encInfo.presentationTimeUs
                }
                val eos = encInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                encoder.releaseOutputBuffer(index, false)
                if (eos) return true
            }
        }

        val totalUs = req.segments.sumOf { (it.endUs - it.startUs).coerceAtLeast(0) }
            .coerceAtLeast(1)
        var doneUs = 0L
        var offsetUs = 0L

        try {
            for (seg in req.segments) {
                if (cancel.get()) throw CancelledException()
                val extractor = MediaExtractor()
                var decoder: MediaCodec? = null
                var renderedMaxUs = -1L
                try {
                    extractor.setDataSource(req.inputPath)
                    extractor.selectTrack(videoTrack)
                    extractor.seekTo(seg.startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)

                    val dec = MediaCodec.createDecoderByType(mime)
                    dec.configure(inputFormat, renderer.surface, null, 0)
                    dec.start()
                    decoder = dec

                    val info = MediaCodec.BufferInfo()
                    var inputDone = false
                    var decodeDone = false
                    val segSpan = (seg.endUs - seg.startUs).coerceAtLeast(1)

                    while (!decodeDone) {
                        if (cancel.get()) throw CancelledException()

                        // 1. alimentation du décodeur
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

                        // 2. décodeur → surface GL → encodeur
                        val index = dec.dequeueOutputBuffer(info, TIMEOUT_US)
                        if (index >= 0) {
                            val pts = info.presentationTimeUs
                            val keep = info.size > 0 && pts >= seg.startUs && pts <= seg.endUs
                            dec.releaseOutputBuffer(index, keep)
                            if (keep && renderer.awaitFrame()) {
                                val rel = pts - seg.startUs
                                renderer.draw(outW, outH)
                                // La vitesse est un simple étirement du temps
                                // de présentation : aucune image inventée.
                                val shown = (rel / speed).toLong()
                                if (overlayGl != null) {
                                    // Calques : effets d'abord (ils altèrent
                                    // les pixels), surimpressions ensuite.
                                    val tUs = offsetUs + shown
                                    overlayGl.drawEffects(outW, outH, overlay.effectsAt(tUs))
                                    overlayGl.drawOverlay(overlay.paintedAt(tUs))
                                }
                                glSurface.setPresentationTime((offsetUs + shown) * 1000)
                                glSurface.swapBuffers()
                                if (rel > renderedMaxUs) renderedMaxUs = rel
                                onProgress(
                                    ((doneUs + rel).toDouble() / totalUs).coerceIn(0.0, 0.99)
                                )
                            }
                            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                                decodeDone = true
                            }
                        }

                        // 3. encodeur → muxer, en continu pour ne jamais saturer
                        drainEncoder()

                        if (segSpan == 0L) decodeDone = true
                    }
                } finally {
                    try { decoder?.stop() } catch (_: Throwable) {}
                    try { decoder?.release() } catch (_: Throwable) {}
                    try { extractor.release() } catch (_: Throwable) {}
                }
                // Raccord sans trou ni recouvrement entre deux segments,
                // exprimé sur l'échelle de temps de sortie (vitesse comprise).
                val used = if (renderedMaxUs >= 0) ((renderedMaxUs + frameDurUs) / speed).toLong()
                else ((seg.endUs - seg.startUs).coerceAtLeast(0) / speed).toLong()
                offsetUs += used
                doneUs += (seg.endUs - seg.startUs).coerceAtLeast(0)
            }

            encoder.signalEndOfInputStream()
            while (true) {
                if (cancel.get()) throw CancelledException()
                if (drainEncoder()) break
            }
            return lastPtsUs
        } finally {
            try { encoder.stop() } catch (_: Throwable) {}
            try { encoder.release() } catch (_: Throwable) {}
            try { renderer.release() } catch (_: Throwable) {}
            try { overlayGl?.release() } catch (_: Throwable) {}
            try { overlay.release() } catch (_: Throwable) {}
            try { glSurface.release() } catch (_: Throwable) {}
            if (muxerStarted) { try { muxer.stop() } catch (_: Throwable) {} }
            try { muxer.release() } catch (_: Throwable) {}
        }
    }

    // ------------------------------------------------------------- helpers

    private fun firstTrack(extractor: MediaExtractor, prefix: String): Int {
        for (i in 0 until extractor.trackCount) {
            val mime = extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: continue
            if (mime.startsWith(prefix)) return i
        }
        return -1
    }

    private fun even(v: Int): Int = if (v % 2 == 0) v else v - 1

    private fun rotationOf(path: String): Int? {
        val mmr = MediaMetadataRetriever()
        return try {
            mmr.setDataSource(path)
            mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull()
        } catch (_: Throwable) {
            null
        } finally {
            try { mmr.release() } catch (_: Throwable) {}
        }
    }

    /** Débit ciblé : celui de la source, jamais gonflé artificiellement. */
    private fun estimateBitrate(path: String, width: Int, height: Int): Int {
        val mmr = MediaMetadataRetriever()
        val source = try {
            mmr.setDataSource(path)
            mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE)?.toIntOrNull()
        } catch (_: Throwable) {
            null
        } finally {
            try { mmr.release() } catch (_: Throwable) {}
        }
        val fallback = (width * height * 4.0).toInt().coerceIn(1_000_000, 20_000_000)
        val target = source?.let { (it * DEFAULT_BITRATE_FACTOR).toInt() } ?: fallback
        return target.coerceIn(500_000, 40_000_000)
    }
}
