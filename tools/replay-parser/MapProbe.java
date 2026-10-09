// Разовый обработчик Clarity: позиции строений и выборка крипов из .dem.
// Вывод: JSON-строки на stdout. {"k":"bld",...} при появлении строения, {"k":"cr","t":...,"p":[[team,x,y],...]} раз в секунду игрового времени.
// Координаты как у odota/parser: cell + vec/128.
import skadistats.clarity.model.Entity;
import skadistats.clarity.model.StringTable;
import skadistats.clarity.event.Insert;
import skadistats.clarity.processor.entities.Entities;
import skadistats.clarity.processor.entities.OnEntityCreated;
import skadistats.clarity.processor.entities.UsesEntities;
import skadistats.clarity.processor.reader.OnTickEnd;
import skadistats.clarity.processor.runner.SimpleRunner;
import skadistats.clarity.processor.runner.Context;
import skadistats.clarity.processor.reader.OnMessage;
import skadistats.clarity.wire.shared.common.proto.CommonNetworkBaseTypes.CNETMsg_Tick;
import skadistats.clarity.processor.stringtables.StringTables;
import skadistats.clarity.processor.stringtables.UsesStringTable;
import skadistats.clarity.source.MappedFileSource;
import java.io.PrintStream;
import java.util.Iterator;

@UsesEntities
@UsesStringTable("EntityNames")
public class MapProbe {
    @Insert private Entities entities;
    private int serverTick;

    @OnMessage(CNETMsg_Tick.class)
    public void onNetTick(CNETMsg_Tick m) { serverTick = m.getTick(); }
    @Insert private StringTables stringTables;
    private final PrintStream out;
    private final double step;
    private double nextT = Double.NEGATIVE_INFINITY;
    MapProbe(PrintStream out, double step) { this.out = out; this.step = step; }

    private static Double num(Entity e, String p) {
        if (!e.hasProperty(p)) return null;
        Object v = e.getProperty(p);
        return v instanceof Number ? ((Number) v).doubleValue() : null;
    }
    private static double[] pos(Entity e) {
        Double cx = num(e, "CBodyComponent.m_cellX"), cy = num(e, "CBodyComponent.m_cellY");
        Double vx = num(e, "CBodyComponent.m_vecX"), vy = num(e, "CBodyComponent.m_vecY");
        if (cx == null || cy == null || vx == null || vy == null) return null;
        return new double[] { cx + vx / 128.0, cy + vy / 128.0 };
    }
    private String name(Entity e) {
        Double i = num(e, "m_pEntity.m_nameStringTableIndex");
        StringTable t = stringTables.forName("EntityNames");
        if (i == null || t == null || i < 0 || i >= t.getEntryCount()) return null;
        return t.getNameByIndex(i.intValue());
    }
    private static String r(double v) { return String.valueOf(Math.round(v * 10) / 10.0); }

    @OnEntityCreated
    public void onCreated(Entity e) {
        String dt = e.getDtClass().getDtName();
        if (!dt.startsWith("CDOTA_BaseNPC_") || !(dt.contains("Tower") || dt.contains("Barracks") || dt.contains("Fort"))) return;
        double[] p = pos(e);
        Double team = num(e, "m_iTeamNum");
        String n = name(e);
        out.println("{\"k\":\"bld\",\"dt\":\"" + dt + "\",\"name\":" + (n == null ? "null" : "\"" + n + "\"")
            + ",\"team\":" + (team == null ? "null" : team.intValue())
            + ",\"x\":" + (p == null ? "null" : r(p[0])) + ",\"y\":" + (p == null ? "null" : r(p[1])) + "}");
    }

    @OnTickEnd
    public void onTickEnd(boolean synthetic) {
        Entity g = entities.stream().filter(Entities.byDtName("CDOTAGamerulesProxy")).findFirst().orElse(null);
        if (g == null) return;
        // Время как у odota/parser: round((serverTick или m_nPauseStartTick во время паузы - m_nTotalPausedTicks) / 30) - round(m_flGameStartTime)
        Double st = num(g, "m_pGameRules.m_flGameStartTime"), paused = num(g, "m_pGameRules.m_nTotalPausedTicks");
        if (st == null || st <= 0) return;
        Object pz = g.hasProperty("m_pGameRules.m_bGamePaused") ? g.getProperty("m_pGameRules.m_bGamePaused") : null;
        Double pst = num(g, "m_pGameRules.m_nPauseStartTick");
        double tick = Boolean.TRUE.equals(pz) && pst != null ? pst : serverTick;
        double gt = Math.round((tick - (paused == null ? 0 : paused)) / 30.0) - Math.round(st);
        Double gs = num(g, "m_pGameRules.m_nGameState");
        if (gs != null && gs.intValue() != 5) return;
        if (gt < nextT) return;
        nextT = Math.floor(gt / step) * step + step;
        StringBuilder sb = new StringBuilder();
        int n = 0;
        for (String dt : new String[] { "CDOTA_BaseNPC_Creep_Lane", "CDOTA_BaseNPC_Creep_Siege" }) {
            Iterator<Entity> it = entities.stream().filter(Entities.byDtName(dt)).iterator(); // Clarity 5: потоковый API вместо getAllByDtName
            while (it.hasNext()) {
                Entity e = it.next();
                Double life = num(e, "m_lifeState"), team = num(e, "m_iTeamNum");
                if (life == null || life != 0 || team == null) continue;
                if (e.hasProperty("m_bIsWaitingToSpawn") && Boolean.TRUE.equals(e.getProperty("m_bIsWaitingToSpawn"))) continue;
                double[] p = pos(e);
                if (p == null) continue;
                if (n++ > 0) sb.append(',');
                sb.append('[').append(team.intValue()).append(',').append(r(p[0])).append(',').append(r(p[1])).append(']');
            }
        }
        out.println("{\"k\":\"cr\",\"t\":" + Math.round(gt) + ",\"n\":" + n + ",\"p\":[" + sb + "]}");
    }

    public static void main(String[] a) throws Exception {
        PrintStream out = new PrintStream(new java.io.BufferedOutputStream(System.out, 1 << 16), false, "UTF-8");
        new SimpleRunner(new MappedFileSource(a[0])).runWith(new MapProbe(out, a.length > 1 ? Double.parseDouble(a[1]) : 1.0));
        out.flush();
    }
}
