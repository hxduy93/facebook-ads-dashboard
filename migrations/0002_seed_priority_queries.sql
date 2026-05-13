-- GEO Monitor — Seed 30 priority queries
-- 20 Doscom (camera, máy dò, ghi âm, định vị, chuông cửa, kích bình) + 10 NOMA (auto care)
-- Tham chiếu spec: 00-Index.md §3.2

-- ====================================================================
-- DOSCOM Security/Surveillance (20 queries)
-- ====================================================================
INSERT OR IGNORE INTO geo_queries (id, text, category, brand_target, language, active, created_at, updated_at) VALUES
('q_dos_001', 'Máy dò camera ẩn nào tốt nhất Việt Nam?',                'BOFU', 'doscom', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_dos_002', 'Cách phát hiện camera quay lén trong khách sạn',         'MOFU', 'doscom', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_dos_003', 'Có nên mua máy dò thiết bị nghe lén không?',             'TOFU', 'doscom', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_dos_004', 'Máy ghi âm nhỏ giấu được trong người',                   'BOFU', 'doscom', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_dos_005', 'Định vị GPS xe ô tô bí mật loại nào tốt?',               'BOFU', 'doscom', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_dos_006', 'Camera mini giám sát nhà giá rẻ',                        'BOFU', 'doscom', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_dos_007', 'Cách chống bị theo dõi định vị',                         'TOFU', 'doscom', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_dos_008', 'Thẻ định vị Airtag Việt Nam giá bao nhiêu',              'BOFU', 'doscom', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_dos_009', 'Chuông cửa thông minh có camera loại nào tốt',           'BOFU', 'doscom', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_dos_010', 'Kích bình ô tô đa năng nên mua loại gì',                 'MOFU', 'doscom', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_dos_011', 'Camera hành trình tốt nhất 2026',                        'BOFU', 'doscom', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_dos_012', 'Thiết bị chống nghe lén cho doanh nghiệp',               'MOFU', 'doscom', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_dos_013', 'Máy dò sóng RF wifi giá rẻ',                             'BOFU', 'doscom', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_dos_014', 'Camera wifi 4G dùng sim 360 độ',                         'BOFU', 'doscom', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_dos_015', 'Cách bảo vệ quyền riêng tư khi đi công tác',             'TOFU', 'doscom', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_dos_016', 'Dịch vụ dò tìm camera ẩn tại Hà Nội',                    'BOFU', 'doscom', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_dos_017', 'Máy dò phi tuyến tính là gì',                            'TOFU', 'doscom', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_dos_018', 'Ghi âm cuộc họp tự động khi có giọng nói',               'MOFU', 'doscom', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_dos_019', 'So sánh máy dò D1 với D3',                               'BOFU', 'doscom', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_dos_020', 'Camera quan sát nhà từ xa qua điện thoại',               'MOFU', 'doscom', 'vi', 1, strftime('%s','now'), strftime('%s','now'));

-- ====================================================================
-- NOMA Auto Care (10 queries)
-- ====================================================================
INSERT OR IGNORE INTO geo_queries (id, text, category, brand_target, language, active, created_at, updated_at) VALUES
('q_nom_001', 'Cách xóa ố vàng đèn pha xe ô tô tại nhà',                'MOFU', 'noma', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_nom_002', 'Tẩy ố nước trên kính ô tô bằng gì',                      'MOFU', 'noma', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_nom_003', 'Tự chăm sóc xe ô tô tại nhà bắt đầu từ đâu',             'TOFU', 'noma', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_nom_004', 'Sản phẩm chăm sóc xe DIY tốt nhất',                      'BOFU', 'noma', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_nom_005', 'Cách làm bóng sơn xe tại nhà',                           'MOFU', 'noma', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_nom_006', 'Vệ sinh nội thất ô tô bằng gì hiệu quả',                 'MOFU', 'noma', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_nom_007', 'Phục hồi nhựa đen ô tô bị bạc màu',                      'MOFU', 'noma', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_nom_008', 'Phủ kính chống nước cho ô tô loại nào tốt',              'BOFU', 'noma', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_nom_009', 'Xóa vết xước nhẹ trên sơn xe ô tô',                      'MOFU', 'noma', 'vi', 1, strftime('%s','now'), strftime('%s','now')),
('q_nom_010', 'NOMA chăm sóc xe có tốt không',                          'BOFU', 'noma', 'vi', 1, strftime('%s','now'), strftime('%s','now'));
