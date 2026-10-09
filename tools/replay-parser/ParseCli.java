// Разбор одного .dem без HTTP-сервера: stdin -> line-delimited JSON на stdout.
// Обёртка над opendota.Parse (odota/parser, MIT), чтобы не открывать порт 5600 на общем хостинге.
public class ParseCli {
    public static void main(String[] args) throws Exception {
        java.io.OutputStream out = new java.io.BufferedOutputStream(System.out, 1 << 16);
        new opendota.Parse(new java.io.BufferedInputStream(System.in, 1 << 16), out, false);
        out.flush();
    }
}
