package com.parkingconcepts.mortimer

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.os.ParcelFileDescriptor
import kotlin.math.sqrt

class PdfReaderActivity : Activity() {
    private var descriptor: ParcelFileDescriptor? = null
    private var renderer: PdfRenderer? = null
    private var pageIndex = 0
    private lateinit var pageImage: ImageView
    private lateinit var pageLabel: TextView
    private lateinit var previous: Button
    private lateinit var next: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(7, 7, 10)
        window.navigationBarColor = Color.rgb(7, 7, 10)
        val uri = intent.data
        if (uri == null) {
            finish()
            return
        }
        try {
            descriptor = contentResolver.openFileDescriptor(uri, "r")
            val fd = descriptor ?: throw IllegalStateException("Could not open the PDF")
            renderer = PdfRenderer(fd)
        } catch (error: Exception) {
            showError(error.message ?: "Could not open this PDF")
            return
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(7, 7, 10))
            setPadding(12, 8, 12, 8)
        }
        val header = TextView(this).apply {
            text = intent.getStringExtra(EXTRA_TITLE) ?: "PDF Reader"
            setTextColor(Color.WHITE)
            textSize = 18f
            gravity = Gravity.CENTER_VERTICAL
            setPadding(4, 8, 4, 12)
        }
        root.addView(header, LinearLayout.LayoutParams(-1, -2))
        pageImage = ImageView(this).apply {
            adjustViewBounds = true
            scaleType = ImageView.ScaleType.FIT_CENTER
        }
        val scroll = ScrollView(this).apply {
            addView(pageImage, ViewGroup.LayoutParams(-1, -2))
        }
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        val controls = LinearLayout(this).apply {
            gravity = Gravity.CENTER
            orientation = LinearLayout.HORIZONTAL
        }
        previous = Button(this).apply {
            text = "Previous"
            setOnClickListener { showPage(pageIndex - 1) }
        }
        pageLabel = TextView(this).apply {
            setTextColor(Color.WHITE)
            textSize = 14f
            gravity = Gravity.CENTER
        }
        next = Button(this).apply {
            text = "Next"
            setOnClickListener { showPage(pageIndex + 1) }
        }
        controls.addView(previous)
        controls.addView(pageLabel, LinearLayout.LayoutParams(0, -2, 1f))
        controls.addView(next)
        root.addView(controls, LinearLayout.LayoutParams(-1, -2))
        setContentView(root)
        val progressKey = readingProgressKey(uri, "pdf")
        showPage(getSharedPreferences("reading_progress", MODE_PRIVATE).getInt(progressKey, 0))
    }

    private fun showPage(index: Int) {
        val pdf = renderer ?: return
        if (index !in 0 until pdf.pageCount) return
        try {
            val page = pdf.openPage(index)
            val screenWidth = (resources.displayMetrics.widthPixels - 32).coerceAtLeast(320)
            val fitScale = screenWidth.toDouble() / page.width.coerceAtLeast(1)
            var renderWidth = screenWidth
            var renderHeight = (page.height.toDouble() * fitScale)
                .coerceIn(1.0, Int.MAX_VALUE.toDouble()).toInt()
            val estimatedPixels = renderWidth.toLong() * renderHeight.toLong()
            if (estimatedPixels > MAX_RENDER_PIXELS) {
                val downscale = sqrt(MAX_RENDER_PIXELS.toDouble() / estimatedPixels.toDouble())
                renderWidth = (renderWidth * downscale).toInt().coerceAtLeast(1)
                renderHeight = (renderHeight * downscale).toInt().coerceAtLeast(1)
            }

            val bitmap = Bitmap.createBitmap(renderWidth, renderHeight, Bitmap.Config.ARGB_8888)
            bitmap.eraseColor(Color.WHITE)
            try {
                page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            } catch (error: Throwable) {
                if (!bitmap.isRecycled) bitmap.recycle()
                throw error
            } finally {
                page.close()
            }
            val previousBitmap = pageImage.drawable?.let { (it as? android.graphics.drawable.BitmapDrawable)?.bitmap }
            pageImage.setImageBitmap(bitmap)
            if (previousBitmap != null && previousBitmap !== bitmap && !previousBitmap.isRecycled) previousBitmap.recycle()
            pageIndex = index
            getSharedPreferences("reading_progress", MODE_PRIVATE).edit().putInt(readingProgressKey(intent.data ?: Uri.EMPTY, "pdf"), index).apply()
            pageLabel.text = "${index + 1} / ${pdf.pageCount}"
            previous.isEnabled = index > 0
            next.isEnabled = index < pdf.pageCount - 1
        } catch (error: Exception) {
            showError(error.message ?: "Could not render the page")
        }
    }

    private fun showError(message: String) {
        setContentView(TextView(this).apply {
            text = "Could not open the PDF.\n$message"
            textSize = 18f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.rgb(7, 7, 10))
            gravity = Gravity.CENTER
            setPadding(24, 24, 24, 24)
        })
    }

    override fun onDestroy() {
        renderer?.close()
        descriptor?.close()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_TITLE = "pdf_title"
        private const val MAX_RENDER_PIXELS = 4_000_000L
        private fun readingProgressKey(uri: Uri, type: String): String = "${type}_${uri.toString().hashCode()}"
    }
}
