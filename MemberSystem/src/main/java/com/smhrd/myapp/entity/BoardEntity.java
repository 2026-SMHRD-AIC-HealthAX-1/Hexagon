package com.smhrd.myapp.entity;

import java.time.LocalDateTime;

import org.hibernate.annotations.CreationTimestamp;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Entity
@AllArgsConstructor
@NoArgsConstructor
@Data
public class BoardEntity { // board_entity

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long idx; // 게시물 식별 번호
	
	private String title; // 제목
	
	private String writer; // 작성자
	
	private String content; // 내용
	
	private String filename; // 파일의 이름
	
	@CreationTimestamp
	private LocalDateTime indate; // 게시물 작성 날짜
	
	
}
