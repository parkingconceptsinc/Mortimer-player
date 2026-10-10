package com.parkingconcepts.mortimer

import android.app.Activity
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.text.Html
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.io.File
import java.util.zip.ZipFile

class EpubReaderActivity : Activity() {
    private var archive: File? = null
    private var zip: ZipFile? = null
    private var chapters: List<Pair<String, String>> = emptyList()
    private var chapterIndex = 0
    private lateinit var heading: TextView
    private lateinit var body: TextView
    private lateinit var scroll: ScrollView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            val uri = intent.data ?: error("No se recibió el archivo EPUB.")
            archive = File(cacheDir, "book_${System.currentTimeMillis()}.epub").also { target ->
                contentResolver.openInputStream(uri)?.use { input -> target.outputStream().use { output -> input.copyTo(output) } }
                    ?: error("No se pudo leer el archivo EPUB.")
            }
            zip = ZipFile(archive!!)
            val container = zip!!.getInputStream(zip!!.getEntry("META-INF/container.xml") ?: error("EPUB no válido."))
                .bufferedReader().use { it.readText() }
            val opfPath = Regex("""full-path\s*=\s*["']([^"']+)["']""").find(container)?.groupValues?.get(1)
                ?: error("No se encontró el paquete de lectura EPUB.")
            val opf = zip!!.getInputStream(zip!!.getEntry(opfPath) ?: error("Falta el archivo OPF."))
                .bufferedReader().use { it.readText() }
            val base = opfPath.substringBeforeLast('/', "")
            val manifest = Regex("""<item\b([^>]+?)/?>""", RegexOption.IGNORE_CASE).findAll(opf).mapNotNull { match ->
                val attrs = match.groupValues[1]
                val id = Regex("""\bid\s*=\s*["']([^"']+)["']""").find(attrs)?.groupValues?.get(1)
                val href = Regex("""\bhref\s*=\s*["']([^"']+)["']""").find(attrs)?.groupValues?.get(1)
                if (id != null && href != null && (href.endsWith(".xhtml", true) || href.endsWith(".html", true) || href.endsWith(".htm", true))) {
                    id to (if (base.isEmpty()) href else "$base/$href").replace("/./", "/")
                } else null
            }.toMap()
            val spine = Regex("""<itemref\b[^>]*\bidref\s*=\s*["']([^"']+)["'][^>]*/?>""", RegexOption.IGNORE_CASE)
                .findAll(opf).mapNotNull { manifest[it.groupValues[1]] }.toList()
            chapters = spine.mapNotNull { path ->
                val entry = zip!!.getEntry(path) ?: return@mapNotNull null
                val html = zip!!.getInputStream(entry).bufferedReader().use { it.readText() }
                val title = Regex("""<title[^>]*>(.*?)</title>""", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))
                    .find(html)?.groupValues?.get(1)?.replace(Regex("<[^>]+>"), "")?.trim()?.takeIf { it.isNotEmpty() }
                    ?: path.substringAfterLast('/')
                path to "$title\n\n" + htmlToText(html)
            }
            check(chapters.isNotEmpty()) { "El EPUB no contiene capítulos compatibles." }
            buildLayout()
            showChapter(0)
        } catch (error: Exception) {
            Toast.makeText(this, error.message ?: "No se pudo abrir el EPUB.", Toast.LENGTH_LONG).show()
            finish()
        }
    }

    private fun htmlToText(html: String): CharSequence {
        val cleaned = html.replace(Regex("(?is)<(script|style)[^>]*>.*?</\\1>"), "")
        return Html.fromHtml(cleaned, Html.FROM_HTML_MODE_COMPACT)
    }

    private fun buildLayout() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(18, 18, 18, 18)
            setBackgroundColor(Color.rgb(7, 7, 10))
        }
        heading = TextView(this).apply {
            textSize = 18f; setTextColor(Color.rgb(255, 120, 73)); gravity = Gravity.CENTER
        }
        scroll = ScrollView(this)
        body = TextView(this).apply {
            textSize = 18f; setTextColor(Color.rgb(240, 240, 244)); setLineSpacing(8f, 1f)
            setPadding(0, 18, 0, 18)
        }
        scroll.addView(body)
        val controls = LinearLayout(this).apply { gravity = Gravity.CENTER }
        controls.addView(Button(this).apply { text = "← Capítulo anterior"; setOnClickListener { showChapter(chapterIndex - 1) } })
        controls.addView(Button(this).apply { text = "Siguiente →"; setOnClickListener { showChapter(chapterIndex + 1) } })
        root.addView(heading)
        root.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(controls)
        setContentView(root)
    }

    private fun showChapter(index: Int) {
        if (chapters.isEmpty()) return
        chapterIndex = index.coerceIn(0, chapters.lastIndex)
        val content = chapters[chapterIndex].second
        val split = content.indexOf("\n\n")
        heading.text = "Capítulo ${chapterIndex + 1} de ${chapters.size}"
        body.text = content.substring(0, split) + "\n\n" + content.substring(split + 2)
        scroll.scrollTo(0, 0)
    }

    override fun onDestroy() {
        zip?.close()
        archive?.delete()
        super.onDestroy()
    }
}
